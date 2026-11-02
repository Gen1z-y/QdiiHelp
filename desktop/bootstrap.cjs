/**
 * 后端进程引导入口（Electron utilityProcess / 纯 Node 双模）。
 *
 * 为什么是 .cjs：Electron 的 utilityProcess 只保证 CommonJS 入口行为稳定，
 * 而后端 server.mjs 是 ESM 且依赖顶层 await，这里用 CJS 引导再动态 import，
 * 两种运行方式都能工作：
 *   - Electron：主进程 utilityProcess.fork，走 process.parentPort 收发消息
 *   - 纯 Node：`node desktop/bootstrap.cjs`，走 stdin/stdout 行协议（便于集成测试）
 *
 * 环境变量约定（由主进程注入）：
 *   PORT                 后端监听端口，桌面端固定传 0 由系统分配
 *   QDII_DATABASE_CONFIG 数据库连接配置绝对路径（userData 内）
 *   QDII_WEB_ROOT        静态资源根目录（旧页面 public/ 或构建产物 out/renderer）
 *   QDII_STORAGE / QDII_DATA_FILE  体验模式（JSON 存储）时使用
 */

const parentPort = process.parentPort;
const readline = require('node:readline');

const HEARTBEAT_MS = 3000;
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);

let stopping = false;
let refreshing = null;
let backend = null;
let heartbeat = null;

/** 统一的对外消息通道：桌面端走 parentPort，纯 Node 走 stdout 行协议。 */
function emit(payload) {
  if (parentPort) {
    parentPort.postMessage(payload);
    return;
  }
  process.stdout.write('QDII_CONTROL ' + JSON.stringify(payload) + '\n');
}

async function stop() {
  if (stopping) return;
  stopping = true;
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  emit({ type: 'stopping' });
  try {
    const app = await backend;
    // 启动尚未完成就收到 stop：直接退出，不触碰未初始化的应用对象。
    if (!app) {
      emit({ type: 'stopped' });
      process.exit(0);
    }
    console.error('[bootstrap] 开始关闭后端');
    await app.shutdown();
    console.error('[bootstrap] 后端已关闭');
    emit({ type: 'stopped' });
    process.exit(0);
  } catch (error) {
    // 保存失败时保留进程便于排查，而不是强制退出丢掉未落库的数据。
    emit({ type: 'error', phase: 'shutdown', message: '关闭失败：' + error.message });
    stopping = false;
  }
}

async function refresh(id) {
  if (stopping) {
    emit({ type: 'refresh-result', id, ok: false, message: '后台正在关闭，请稍后再刷新' });
    return;
  }
  if (refreshing) {
    emit({ type: 'refresh-busy', id });
    return;
  }
  const task = (async () => {
    emit({ type: 'refresh-started', id });
    try {
      const app = await backend;
      await app.serverReady;
      const run = await app.refreshFromTray((progress) =>
        emit({
          type: 'refresh-progress',
          id,
          completed: progress.completed,
          total: progress.total,
        }),
      );
      const failed = run.counts?.failed ?? 0;
      const historyFailed = run.historyErrors?.length ?? 0;
      emit({
        type: 'refresh-result',
        id,
        ok: true,
        warning: failed > 0 || historyFailed > 0,
        runId: run.id,
        counts: run.counts ?? null,
        message:
          '刷新完成：共 ' +
          (run.counts?.total ?? 0) +
          ' 只，已更新 ' +
          (run.counts?.updated ?? 0) +
          ' 只，复用缓存 ' +
          (run.counts?.cached ?? 0) +
          ' 只' +
          (failed ? '；' + failed + ' 只刷新异常' : '') +
          (historyFailed ? '；' + historyFailed + ' 只历史净值同步异常' : '') +
          (run.historyPending ? '；历史曲线仍在后台同步' : '') +
          (run.counts?.unavailable ? '；' + run.counts.unavailable + ' 只暂无预估且未公布' : '') +
          '。',
      });
    } catch (error) {
      emit({ type: 'refresh-result', id, ok: false, message: '刷新失败：' + error.message });
    }
  })();
  refreshing = task;
  try {
    await task;
  } finally {
    refreshing = null;
  }
}

/**
 * 首次启动的空库初始化：桌面端自动建好数据库集群后，库里还没有项目记录，
 * 直接启动 server.mjs 会因「数据库尚未导入项目数据」退出。
 * 这里写入与 `npm run db:migrate` 相同形状的空状态，之后正常启动即可。
 */
async function ensureInitialized() {
  const { PostgresStore } = await import('../lib/postgres-store.mjs');
  const { databaseConfig } = await import('../lib/database-config.mjs');
  const empty = { version: 1, watchlist: [], profiles: {}, records: {}, lastView: {} };
  const store = await PostgresStore.open('postgres:qdiihelp', databaseConfig(), { initialData: empty });
  try {
    // 已有项目记录时 hashes 非空，说明不是空库，不要覆盖。
    if (!store.hashes.size) await store.save();
  } finally {
    await store.close();
  }
}

function handleCommand(raw) {
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return;
  }
  if (!data || typeof data !== 'object') return;
  if (data.command === 'stop') void stop();
  else if (data.command === 'refresh') void refresh(data.id);
}

async function main() {
  if (NODE_MAJOR < 22) {
    emit({ type: 'error', phase: 'startup', message: 'Node.js 22 或以上版本是必需的' });
    process.exitCode = 1;
    return;
  }

  if (parentPort) parentPort.on('message', (event) => handleCommand(event.data));
  else {
    const lines = readline.createInterface({ input: process.stdin });
    lines.on('line', handleCommand);
    lines.on('close', () => {
      if (!stopping) void stop();
    });
  }

  // 空库初始化必须早于 server.mjs 的模块求值（它会在顶层打开数据库）。
  backend = (async () => {
    if (process.env.QDII_AUTO_INIT === '1') await ensureInitialized();
    return import('../server.mjs');
  })();
  try {
    const app = await backend;
    await app.serverReady;
    if (stopping) return;
    emit({ type: 'ready', pid: process.pid, port: app.server.address().port });
    heartbeat = setInterval(() => emit({ type: 'status', busy: app.runtimeStatus().busy }), HEARTBEAT_MS);
    // 心跳不阻止进程退出，由 stop 流程显式清理。
    heartbeat.unref?.();
  } catch (error) {
    emit({ type: 'error', phase: 'startup', message: error.message });
    console.error(error.stack);
    process.exit(1);
  }
}

void main();
