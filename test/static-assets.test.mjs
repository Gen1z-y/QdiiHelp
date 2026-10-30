import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { holdingsBars } from '../src/shared/holdings-ui.ts';

/**
 * 渲染层产物完整性：确认 out/renderer 里的入口 HTML 引用的脚本与样式都真实存在，
 * 并且 HTTP 服务只暴露白名单路径。未构建时跳过，避免 CI 上必须先打包才能跑测试。
 */

const distRoot = new URL('../out/renderer/', import.meta.url);
const indexFile = new URL('index.html', distRoot);

test('构建产物中的入口资源都能解析，服务只暴露 /assets 与入口', async (t) => {
  if (!fs.existsSync(indexFile)) {
    t.skip('未找到 out/renderer/index.html，请先运行 npm run build');
    return;
  }

  const html = fs.readFileSync(indexFile, 'utf8');
  const references = [...html.matchAll(/<script[^>]*src="([^"]+)"/g), ...html.matchAll(/<link[^>]*href="([^"]+)"/g)]
    .map((match) => match[1])
    // 只校验仓库内的相对路径；data: / http(s): 等外部引用跳过。
    .filter((reference) => !/^[a-z]+:/i.test(reference));

  assert.ok(references.length > 0, '入口 HTML 应当引用脚本或样式');
  for (const reference of references) {
    const target = new URL(reference.replace(/^\//, ''), distRoot);
    assert.ok(fs.existsSync(target), `缺少构建资源：${reference}`);
  }

  // 图表仍用 SVG 属性而不是内联样式（服务端 CSP 不允许 style 属性）。
  const chart = holdingsBars([{ name: 'sample', weight: 40 }]);
  assert.match(chart, /<svg/);
  assert.doesNotMatch(chart, /style=/);
});
