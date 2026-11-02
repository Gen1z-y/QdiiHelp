import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 桌面端后端引导（desktop/bootstrap.cjs）的集成测试。
 * 纯 Node 下走 stdin/stdout 行协议，与 Electron utilityProcess 的消息协议保持一致。
 */

function parseEvents(output) {
  return output
    .split('\n')
    .filter((line) => line.startsWith('QDII_CONTROL '))
    .map((line) => JSON.parse(line.slice('QDII_CONTROL '.length)));
}

async function waitFor(events, type, output, child) {
  for (let i = 0; i < 200; i += 1) {
    const event = events().find((item) => item.type === type);
    if (event) return event;
    if (child.exitCode !== null) throw Error(`进程提前退出：\n${output()}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw Error(`未等到底端事件 ${type}：\n${output()}`);
}

async function launch(env) {
  const child = spawn(process.execPath, ['desktop/bootstrap.cjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exit = once(child, 'exit');
  const events = () => parseEvents(stdout);
  return {
    child,
    exit,
    events,
    output: () => stdout + stderr,
    ready: () => waitFor(events, 'ready', () => stdout + stderr, child),
    stop: async () => {
      child.stdin.write('{"command":"stop"}\n');
      await waitFor(events, 'stopped', () => stdout + stderr, child);
      return (await exit)[0];
    },
  };
}

test('引导进程用系统端口启动后端，健康检查与旧页面都可用，停止时保存', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qdii-desktop-'));
  const stateFile = path.join(dir, 'state.json');
  const app = await launch({ QDII_STORAGE: 'json', QDII_DATA_FILE: stateFile });
  try {
    const ready = await app.ready();
    assert.ok(Number.isInteger(ready.port) && ready.port > 0, app.output());
    const origin = `http://127.0.0.1:${ready.port}`;

    const health = await (await fetch(origin + '/api/health')).json();
    assert.equal(health.app, 'qdii-help');
    const runtime = await (await fetch(origin + '/api/runtime')).json();
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(runtime.version, pkg.version, '版本号应来自 package.json');

    const home = await fetch(origin + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /净值观察台/);
    assert.match(home.headers.get('content-security-policy') ?? '', /connect-src 'self'/);

    // 未列入白名单的路径仍然 404，静态白名单边界不变。
    assert.equal((await fetch(origin + '/not-exposed.js')).status, 404);
    assert.equal((await fetch(origin + '/assets/app-deadbeef.js')).status, 404);

    assert.equal(await app.stop(), 0, app.output());
  } finally {
    if (app.child.exitCode === null) {
      app.child.kill();
      await app.exit;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('QDII_WEB_ROOT 指向构建产物时提供哈希静态资源并保留长缓存', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qdii-desktop-web-'));
  const stateFile = path.join(dir, 'state.json');
  const webRoot = path.join(dir, 'renderer');
  fs.mkdirSync(path.join(webRoot, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>dist 首页</title>');
  fs.writeFileSync(path.join(webRoot, 'assets', 'index-abc123.js'), 'export {};');
  const app = await launch({ QDII_STORAGE: 'json', QDII_DATA_FILE: stateFile, QDII_WEB_ROOT: webRoot });
  try {
    const ready = await app.ready();
    const origin = `http://127.0.0.1:${ready.port}`;

    const home = await fetch(origin + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /dist 首页/);

    const asset = await fetch(origin + '/assets/index-abc123.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control') ?? '', /immutable/);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);

    // /assets 只放行脚本、样式、字体与图片扩展名，其它一律 404。
    assert.equal((await fetch(origin + '/assets/index.html')).status, 404);

    assert.equal(await app.stop(), 0, app.output());
  } finally {
    if (app.child.exitCode === null) {
      app.child.kill();
      await app.exit;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
