import { app } from 'electron';
import pg from 'pg';
import { log } from './log';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * 内嵌 PostgreSQL 的启动与配置管理。
 *
 * 直接驱动 PostgreSQL 自带二进制（initdb / pg_ctl），不依赖第三方封装：
 * - 二进制来自平台包 @embedded-postgres/windows-x64（只含 server 侧可执行文件）
 * - 数据目录放在 userData/pgdata，日志放在 userData/pg.log
 * - 关闭时用 `pg_ctl -m fast` 等待干净退出，避免留下 postmaster.pid
 *
 * 三种情形：
 * 1. 用户自备连接配置（QDII_DATABASE_CONFIG 或非本项目托管的 database.json）→ 只使用，不管理
 * 2. 本项目托管的配置存在（含 managedBy: 'embedded'）→ 用记录的数据目录与端口启动
 * 3. 首次启动 → 选空闲端口、initdb、建库、写配置，并标记本次新建
 */

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
  connectionTimeoutMillis?: number;
  /** 本项目写入的标记：由内嵌实例托管，退出时一并停止。 */
  managedBy?: 'embedded';
  /** 内嵌实例的数据目录（绝对路径）。 */
  dataDir?: string;
}

const PLATFORM_PACKAGE = '@embedded-postgres/windows-x64';
const CONFIG_NAME = 'database.json';
const DATABASE_NAME = 'qdiihelp';
const DATABASE_USER = 'qdiihelp_app';
const DUPLICATE_DATABASE = '42P04';
const COMMAND_TIMEOUT_MS = 120_000;

/**
 * 平台二进制目录。
 * 打包后由 electron-builder 复制到 resources/pg/native（asar 内无法执行 exe）；
 * 开发期直接从 node_modules 读取，兼容 asar.unpacked 布局。
 */
function binaryDir(): string {
  const packaged = join(process.resourcesPath ?? '', 'pg', 'native', 'bin');
  if (app.isPackaged && existsSync(packaged)) return packaged;
  const dev = join(app.getAppPath(), 'node_modules', PLATFORM_PACKAGE, 'native', 'bin');
  const unpacked = dev.replace('app.asar', 'app.asar.unpacked');
  return existsSync(unpacked) ? unpacked : dev;
}

/**
 * 执行 PostgreSQL 自带命令并等待结束。
 *
 * 注意两点：
 * - 用 exit 而不是 close：`pg_ctl start` 会把 postgres 作为子进程留下，
 *   子进程继承的输出管道不关闭时 close 永远不会触发。
 * - 启动命令不接管输出（stdio: ignore），日志由 pg_ctl -l 写入文件。
 */
function run(command: string, args: string[], options: { captureOutput?: boolean } = {}): Promise<string> {
  const captureOutput = options.captureOutput ?? true;
  return new Promise((resolve, reject) => {
    const child = spawn(join(binaryDir(), command), args, {
      windowsHide: true,
      stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} 超时`));
    }, COMMAND_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`${command} 退出码 ${code}：${output.trim().slice(-400)}`));
    });
  });
}

/** 停止指定数据目录下的数据库实例（数据目录迁移前使用）。 */
export async function stopDatabaseAt(dataDir: string): Promise<boolean> {
  if (!existsSync(join(dataDir, 'postmaster.pid'))) return true;
  try {
    await run('pg_ctl.exe', ['-D', dataDir, '-m', 'fast', '-w', '-t', '30', 'stop']);
    return true;
  } catch (error) {
    log('停止旧数据库失败：' + (error instanceof Error ? error.message : String(error)));
    return false;
  }
}

/** 取一个当前空闲的本机端口，交给 PostgreSQL 使用。 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('无法分配数据库端口'))));
    });
  });
}

export class Database {
  private configPath: string | null = null;
  private config: DatabaseConfig | null = null;
  private running = false;

  /** 本次启动是否新建了数据库集群；为真时后端需要执行一次空状态初始化。 */
  created = false;

  /** 准备数据库并返回连接配置的路径（供后端 QDII_DATABASE_CONFIG 使用）。 */
  async start(): Promise<string> {
    if (this.configPath) return this.configPath;

    // 开发期优先复用仓库里的本地配置，避免把开发数据写进 userData。
    const devConfig = join(app.getAppPath(), 'config', 'database.local.json');
    if (!app.isPackaged && !process.env.QDII_DATABASE_CONFIG && existsSync(devConfig)) {
      this.configPath = devConfig;
      return devConfig;
    }

    const configPath = process.env.QDII_DATABASE_CONFIG ?? join(app.getPath('userData'), CONFIG_NAME);
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as DatabaseConfig;
      if (config.managedBy !== 'embedded') {
        // 外部 PostgreSQL：只使用，不管理。
        log('数据库：使用外部连接配置 ' + configPath);
        this.configPath = configPath;
        return configPath;
      }
      log(`数据库：启动内嵌实例（端口 ${config.port}）`);
      await this.launch(config);
      this.configPath = configPath;
      this.config = config;
      return configPath;
    }

    const dataDir = join(app.getPath('userData'), 'pgdata');
    const fresh = !existsSync(join(dataDir, 'PG_VERSION'));
    const config: DatabaseConfig = {
      host: '127.0.0.1',
      port: await freePort(),
      database: DATABASE_NAME,
      user: DATABASE_USER,
      password: randomBytes(18).toString('base64url'),
      max: 4,
      connectionTimeoutMillis: 8000,
      managedBy: 'embedded',
      dataDir,
    };
    if (fresh) {
      // 上一次 initdb 可能中途失败，留下没有 PG_VERSION 的残留目录，先清干净再初始化。
      if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
      mkdirSync(dataDir, { recursive: true });
      log('数据库：首次启动，执行 initdb（约 5–15 秒）');
      await this.initialise(dataDir, config.password);
      log('数据库：initdb 完成');
    }
    log(`数据库：启动内嵌实例（端口 ${config.port}）`);
    await this.launch(config);
    await this.createDatabase(config);
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    log('数据库：已写入连接配置 ' + configPath);
    this.configPath = configPath;
    this.config = config;
    this.created = fresh;
    return configPath;
  }

  /** 首次启动：initdb 建立集群（用户名与密码一并写入）。 */
  private async initialise(dataDir: string, password: string): Promise<void> {
    // 密码文件必须放在数据目录之外：initdb 要求目标目录为空。
    const passwordFile = join(app.getPath('userData'), '.initdb-password');
    writeFileSync(passwordFile, password, 'utf8');
    try {
      await run('initdb.exe', [
        '-D',
        dataDir,
        '-U',
        DATABASE_USER,
        '-E',
        'UTF8',
        // Windows 上 --locale=C 会被判为无效语言环境，--no-locale 才是安全的 C locale。
        '--no-locale',
        '--auth-host=scram-sha-256',
        '--auth-local=scram-sha-256',
        `--pwfile=${passwordFile}`,
      ]);
    } finally {
      rmSync(passwordFile, { force: true });
    }
  }

  /** 启动集群；数据目录里的 postmaster.pid 若属于已退出的进程则先清理。 */
  private async launch(config: DatabaseConfig): Promise<void> {
    const dataDir = config.dataDir as string;
    const logFile = join(app.getPath('userData'), 'postgres.log');
    try {
      await run(
        'pg_ctl.exe',
        ['-D', dataDir, '-l', logFile, '-o', `-p ${config.port} -h 127.0.0.1`, '-w', '-t', '30', 'start'],
        { captureOutput: false },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 上次异常退出可能留下仍在运行的实例：能连上就继续使用，不必中断启动。
      const alive = await this.probePort(config);
      if (!alive) throw new Error(`数据库启动失败：${message}（详见 ${logFile}）`);
      log('数据库已有实例在运行，直接复用');
    }
    this.running = true;
  }

  /** 探测端口上是否已有可用的数据库实例。 */
  private async probePort(config: DatabaseConfig): Promise<boolean> {
    const client = new pg.Client({
      host: config.host,
      port: config.port,
      database: 'postgres',
      user: config.user,
      password: config.password,
      connectionTimeoutMillis: 3000,
    });
    try {
      await client.connect();
      return true;
    } catch {
      return false;
    } finally {
      await client.end().catch(() => {});
    }
  }

  /** 首次启动时创建业务数据库；已存在则忽略。 */
  private async createDatabase(config: DatabaseConfig): Promise<void> {
    log('数据库：创建业务库 ' + DATABASE_NAME);
    const client = new pg.Client({
      host: config.host,
      port: config.port,
      database: 'postgres',
      user: config.user,
      password: config.password,
      connectionTimeoutMillis: 15_000,
    });
    await client.connect();
    try {
      await client.query(`CREATE DATABASE ${DATABASE_NAME}`);
    } catch (error) {
      if ((error as { code?: string }).code !== DUPLICATE_DATABASE) throw error;
    } finally {
      await client.end();
    }
  }

  /** 停止由本项目启动的内嵌实例；外部数据库不做处理。 */
  async stop(): Promise<void> {
    if (!this.running || !this.config?.dataDir) return;
    this.running = false;
    try {
      await run('pg_ctl.exe', ['-D', this.config.dataDir, '-m', 'fast', '-w', '-t', '30', 'stop']);
    } catch (error) {
      console.error('数据库停止失败：' + String(error));
    }
  }

  get current(): DatabaseConfig | null {
    return this.config;
  }
}
