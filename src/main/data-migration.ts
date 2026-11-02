import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 旧数据目录迁移。
 *
 * 早期版本的应用名取自 package.json 的 `name`（qdii-help），数据目录因此是
 * `%APPDATA%/qdii-help`。现在改为 `productName`（QdiiHelp），目录也随之为
 * `%APPDATA%/QdiiHelp`。这里做一次性搬迁，避免升级后「数据消失」。
 *
 * 关键细节：
 * - Electron 会在主进程代码运行前就创建 userData 目录（里面只有 Chromium 缓存），
 *   所以「目标目录存在」不代表用户已有数据；判定要看是否真的存在连接配置或数据库目录。
 * - 目标目录正被本进程占用（缓存文件打开中），不能删除它；因此采用「逐项改名搬入」
 *   的合并方式：把旧目录里的 pgdata / database.json 等改名到新目录，再尝试删空的旧目录。
 * - 目标目录已有用户数据时一律不动，避免覆盖用户在新目录里已经产生的数据。
 */

/** 需要搬迁的用户数据项。 */
const DATA_ITEMS = ['pgdata', 'database.json', 'main.log', 'postgres.log'];

export interface MigrationOptions {
  /** 应用数据根目录（Windows 为 %APPDATA%） */
  appData: string;
  /** 新数据目录名 */
  targetName: string;
  /** 旧数据目录名 */
  legacyName: string;
  /** 迁移前尝试停止旧数据目录中的数据库实例，返回是否可以安全迁移 */
  stopLegacyInstance?: (legacyDir: string) => Promise<boolean>;
  log?: (message: string) => void;
}

export type MigrationStatus = 'migrated' | 'skipped-missing' | 'skipped-target-exists' | 'blocked' | 'failed';

export interface MigrationResult {
  status: MigrationStatus;
  message: string;
  legacyDir: string;
  targetDir: string;
}

/** 目录里是否存在真正的用户数据（连接配置或数据库目录）。 */
function hasUserData(dir: string): boolean {
  return existsSync(join(dir, 'database.json')) || existsSync(join(dir, 'pgdata'));
}

/** 执行一次性数据目录迁移；幂等，可重复调用。 */
export async function migrateUserData(options: MigrationOptions): Promise<MigrationResult> {
  const { appData, targetName, legacyName, stopLegacyInstance, log = () => {} } = options;
  const legacyDir = join(appData, legacyName);
  const targetDir = join(appData, targetName);
  const result = (status: MigrationStatus, message: string): MigrationResult => {
    log(`数据目录迁移：${message}`);
    return { status, message, legacyDir, targetDir };
  };

  if (!existsSync(legacyDir) || !hasUserData(legacyDir)) {
    return result('skipped-missing', '旧数据目录不存在或没有用户数据，无需迁移');
  }
  if (hasUserData(targetDir)) {
    return result('skipped-target-exists', '新数据目录已有用户数据，保留现状');
  }

  // 数据库仍在运行时目录被占用，必须先停掉。
  if (existsSync(join(legacyDir, 'pgdata', 'postmaster.pid'))) {
    const stopped = (await stopLegacyInstance?.(join(legacyDir, 'pgdata'))) ?? false;
    if (!stopped) return result('blocked', '旧数据库未能停止，跳过迁移以保护数据');
  }

  const moved: string[] = [];
  try {
    // 目标目录可能还不存在（Electron 通常会先建好），先确保存在再搬。
    mkdirSync(targetDir, { recursive: true });
    for (const item of DATA_ITEMS) {
      const from = join(legacyDir, item);
      const to = join(targetDir, item);
      if (!existsSync(from) || existsSync(to)) continue;
      renameSync(from, to);
      moved.push(item);
    }
  } catch (error) {
    return result('failed', '迁移失败，保留原目录：' + (error instanceof Error ? error.message : String(error)));
  }

  fixEmbeddedDataDir(targetDir, legacyDir, targetDir, log);
  removeEmptyLegacyDir(legacyDir, log);
  return result('migrated', `已迁移 ${moved.join('、') || '（无内容）'} 到 ${targetDir}`);
}

/**
 * 内置数据库的连接配置里记着数据目录绝对路径，目录改名后要同步更新，
 * 否则应用会去读一个已经不存在的旧路径。
 */
function fixEmbeddedDataDir(
  targetDir: string,
  legacyDir: string,
  newDir: string,
  log: (message: string) => void,
): void {
  const configFile = join(targetDir, 'database.json');
  if (!existsSync(configFile)) return;
  try {
    const config = JSON.parse(readFileSync(configFile, 'utf8')) as { dataDir?: string };
    if (typeof config.dataDir !== 'string' || !config.dataDir.startsWith(legacyDir)) return;
    config.dataDir = newDir + config.dataDir.slice(legacyDir.length);
    writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf8');
    log(`已更新连接配置中的数据目录：${config.dataDir}`);
  } catch (error) {
    log('更新连接配置失败：' + (error instanceof Error ? error.message : String(error)));
  }
}

/** 旧目录搬空后尝试删掉；失败不影响使用，仅提示用户可手动清理。 */
function removeEmptyLegacyDir(legacyDir: string, log: (message: string) => void): void {
  try {
    if (readdirSync(legacyDir).length > 0) {
      log(`旧数据目录仍有其它文件，未删除：${legacyDir}`);
      return;
    }
    rmdirSync(legacyDir);
    log(`已删除空的旧数据目录：${legacyDir}`);
  } catch (error) {
    log(
      '旧数据目录未删除，可手动清理：' +
        legacyDir +
        '（' +
        (error instanceof Error ? error.message : String(error)) +
        '）',
    );
  }
}
