import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateUserData } from '../src/main/data-migration.ts';

/** 应用数据目录改名为 QdiiHelp 时的一次性搬迁逻辑。 */

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qdii-migrate-'));
}

/** 造一个带用户数据的旧目录。 */
function seedLegacy(root, { withConfig = true } = {}) {
  const legacy = path.join(root, 'qdii-help');
  fs.mkdirSync(path.join(legacy, 'pgdata'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'pgdata', 'PG_VERSION'), '18\n');
  if (withConfig) {
    fs.writeFileSync(
      path.join(legacy, 'database.json'),
      JSON.stringify({ managedBy: 'embedded', dataDir: path.join(legacy, 'pgdata'), port: 5432 }),
    );
  }
  return legacy;
}

test('旧目录有用户数据时把数据项搬进新目录', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = seedLegacy(root);

  const result = await migrateUserData({ appData: root, legacyName: 'qdii-help', targetName: 'QdiiHelp' });

  assert.equal(result.status, 'migrated');
  assert.equal(fs.existsSync(path.join(root, 'QdiiHelp', 'pgdata', 'PG_VERSION')), true);
  assert.equal(fs.existsSync(path.join(legacy, 'pgdata')), false, '旧目录里的数据库目录已被搬走');
  assert.equal(fs.existsSync(path.join(legacy, 'database.json')), false);
});

test('迁移后同步更新内置数据库配置里的数据目录路径', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedLegacy(root);

  const result = await migrateUserData({ appData: root, legacyName: 'qdii-help', targetName: 'QdiiHelp' });

  assert.equal(result.status, 'migrated');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'QdiiHelp', 'database.json'), 'utf8'));
  assert.equal(config.dataDir, path.join(root, 'QdiiHelp', 'pgdata'));
  assert.equal(config.port, 5432, '其它配置项保持不变');
});

test('目标目录只是 Electron 自动创建的空壳时，仍然完成迁移', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedLegacy(root);
  // Electron 启动时会先建出 userData 目录（里面只有缓存）
  fs.mkdirSync(path.join(root, 'QdiiHelp', 'Cache'), { recursive: true });

  const result = await migrateUserData({ appData: root, legacyName: 'qdii-help', targetName: 'QdiiHelp' });

  assert.equal(result.status, 'migrated');
  assert.equal(fs.existsSync(path.join(root, 'QdiiHelp', 'pgdata', 'PG_VERSION')), true);
  assert.equal(fs.existsSync(path.join(root, 'QdiiHelp', 'Cache')), true, '目标目录里的缓存保持不动');
});

test('目标目录已有用户数据时不动旧目录，避免覆盖新数据', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = seedLegacy(root);
  fs.mkdirSync(path.join(root, 'QdiiHelp', 'pgdata'), { recursive: true });
  fs.writeFileSync(path.join(root, 'QdiiHelp', 'database.json'), '{"managedBy":"embedded","port":6000}');

  const result = await migrateUserData({ appData: root, legacyName: 'qdii-help', targetName: 'QdiiHelp' });

  assert.equal(result.status, 'skipped-target-exists');
  assert.equal(fs.existsSync(path.join(legacy, 'pgdata')), true);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'QdiiHelp', 'database.json'), 'utf8'));
  assert.equal(config.port, 6000, '新目录的数据不被改动');
});

test('没有旧数据时直接跳过，不动目标目录', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = await migrateUserData({ appData: root, legacyName: 'qdii-help', targetName: 'QdiiHelp' });

  assert.equal(result.status, 'skipped-missing');
  assert.equal(fs.existsSync(path.join(root, 'QdiiHelp')), false);
});

test('旧目录只剩空壳（无连接配置与数据库）时不搬，避免制造空目录', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'qdii-help', 'Cache'), { recursive: true });

  const result = await migrateUserData({ appData: root, legacyName: 'qdii-help', targetName: 'QdiiHelp' });

  assert.equal(result.status, 'skipped-missing');
  assert.equal(fs.existsSync(path.join(root, 'QdiiHelp')), false);
});

test('旧数据库仍在运行时先尝试停止；停不掉则放弃迁移', async (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedLegacy(root);
  fs.writeFileSync(path.join(root, 'qdii-help', 'pgdata', 'postmaster.pid'), '1234');

  const blocked = await migrateUserData({
    appData: root,
    legacyName: 'qdii-help',
    targetName: 'QdiiHelp',
    stopLegacyInstance: async () => false,
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(fs.existsSync(path.join(root, 'qdii-help', 'pgdata')), true);

  const stoppedDirs = [];
  const migrated = await migrateUserData({
    appData: root,
    legacyName: 'qdii-help',
    targetName: 'QdiiHelp',
    stopLegacyInstance: async (dir) => {
      stoppedDirs.push(dir);
      return true;
    },
  });
  assert.equal(migrated.status, 'migrated');
  assert.deepEqual(stoppedDirs, [path.join(root, 'qdii-help', 'pgdata')]);
  assert.equal(fs.existsSync(path.join(root, 'QdiiHelp', 'pgdata', 'postmaster.pid')), true);
});
