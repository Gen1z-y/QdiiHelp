import { app, utilityProcess, type UtilityProcess } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log';
import { Database } from './postgres';

/**
 * 后端进程（utilityProcess）生命周期管理。
 *
 * 设计要点：
 * - 后端仍跑原来的 server.mjs，只监听 127.0.0.1 上系统分配的端口（PORT=0），
 *   因此同源 fetch、Host 校验与 CSP 全部沿用现状，渲染层无需改造。
 * - 引导文件用 CJS（desktop/bootstrap.cjs），内部再动态 import ESM 的 server.mjs，
 *   规避 utilityProcess 对 ESM 入口的兼容性不确定性。
 * - 端口在 ready 消息里回传，主进程拿到后才创建窗口，避免白屏与竞态。
 */

const READY_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 15_000;
const MAX_RESTARTS = 3;

export interface BackendEndpoint {
  url: string;
  port: number;
}

type BackendMessage = {
  type?: string;
  port?: number;
  pid?: number;
  phase?: string;
  message?: string;
  busy?: boolean;
  id?: string;
  ok?: boolean;
  warning?: boolean;
  runId?: string;
};

export interface RefreshOutcome {
  ok: boolean;
  message: string;
  warning?: boolean;
  runId?: string;
}

export class Backend {
  private child: UtilityProcess | null = null;
  private endpoint: BackendEndpoint | null = null;
  private database = new Database();
  private stopping = false;
  private restartCount = 0;
  private readyWaiter: ((value: BackendEndpoint) => void) | null = null;
  private readyRejecter: ((error: Error) => void) | null = null;
  private stopWaiter: (() => void) | null = null;
  private refreshWaiter: ((outcome: RefreshOutcome) => void) | null = null;
  private refreshSeq = 0;

  /** 应用是否正在退出；退出过程中不再自动重启后端。 */
  quitting = false;

  /** 后端异常退出（非主动 stop）时触发，由主进程决定重启或提示用户。 */
  onUnexpectedExit: ((info: { code: number; willRestart: boolean }) => void) | null = null;

  get current(): BackendEndpoint | null {
    return this.endpoint;
  }

  /** 启动数据库与后端并等待就绪，返回可加载的地址。 */
  async start(): Promise<BackendEndpoint> {
    if (this.endpoint) return this.endpoint;
    this.stopping = false;

    // 先确保数据库可用（首次启动会 initdb 并写入连接配置），再拉起后端进程。
    let configPath: string;
    try {
      configPath = await this.database.start();
    } catch (error) {
      log('数据库准备失败：' + (error instanceof Error ? error.message : String(error)));
      throw error;
    }
    log('数据库配置：' + configPath);

    const entry = join(app.getAppPath(), 'desktop', 'bootstrap.cjs');
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    // 打包后端口交给系统分配，避免冲突；开发期用固定端口，Vite 代理才能指向它。
    env.PORT = app.isPackaged ? '0' : (process.env.QDII_DEV_BACKEND_PORT ?? '8787');
    env.QDII_DATABASE_CONFIG = configPath;
    // 本次新建了空库：让后端执行一次空状态初始化（等价于空库导入）。
    if (this.database.created) env.QDII_AUTO_INIT = '1';
    if (app.isPackaged) {
      const webRoot = join(app.getAppPath(), 'out', 'renderer');
      if (!env.QDII_WEB_ROOT && existsSync(webRoot)) env.QDII_WEB_ROOT = webRoot;
    }

    const child = utilityProcess.fork(entry, [], {
      env,
      stdio: 'pipe',
      serviceName: 'QdiiHelp Backend',
    });
    this.child = child;

    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[backend] ${chunk.toString()}`));
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[backend] ${chunk.toString()}`));
    child.on('message', (message: BackendMessage) => this.handleMessage(message));
    child.on('exit', (code) => this.handleExit(code));

    return new Promise<BackendEndpoint>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWaiter = null;
        this.readyRejecter = null;
        reject(new Error(`后端启动超时（${READY_TIMEOUT_MS / 1000} 秒），请检查数据库连接`));
      }, READY_TIMEOUT_MS);
      this.readyWaiter = (endpoint) => {
        clearTimeout(timer);
        resolve(endpoint);
      };
      this.readyRejecter = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    });
  }

  private handleMessage(message: BackendMessage): void {
    if (message.type === 'ready') {
      const port = message.port ?? 0;
      this.endpoint = { port, url: `http://127.0.0.1:${port}/` };
      this.restartCount = 0;
      this.readyWaiter?.(this.endpoint);
      this.readyWaiter = null;
      this.readyRejecter = null;
      return;
    }
    if (message.type === 'stopped') {
      this.stopWaiter?.();
      this.stopWaiter = null;
      return;
    }
    if (message.type === 'refresh-busy' && message.id === String(this.refreshSeq)) {
      this.refreshWaiter?.({ ok: false, message: '后台已有刷新在进行中' });
      this.refreshWaiter = null;
      return;
    }
    if (message.type === 'refresh-result' && message.id === String(this.refreshSeq)) {
      this.refreshWaiter?.({
        ok: message.ok === true,
        message: message.message ?? '',
        warning: message.warning,
        runId: message.runId,
      });
      this.refreshWaiter = null;
      return;
    }
    if (message.type === 'error') {
      this.readyRejecter?.(new Error(message.message ?? '后端启动失败'));
      this.readyRejecter = null;
      this.readyWaiter = null;
    }
  }

  private handleExit(code: number): void {
    const wasStopping = this.stopping;
    this.child = null;
    this.endpoint = null;
    this.stopping = false;
    if (wasStopping) {
      this.stopWaiter?.();
      this.stopWaiter = null;
      return;
    }
    const willRestart = this.restartCount < MAX_RESTARTS && !this.quitting;
    if (willRestart) this.restartCount += 1;
    this.readyRejecter?.(new Error('后端进程已退出'));
    this.readyRejecter = null;
    this.readyWaiter = null;
    this.onUnexpectedExit?.({ code, willRestart });
  }

  /**
   * 触发一次全部刷新（托盘菜单用），返回完成摘要。
   * 刷新可能耗时较久，默认超时 30 分钟；期间事件只转发不重复请求。
   */
  async refresh(timeoutMs = 30 * 60 * 1000): Promise<RefreshOutcome> {
    const child = this.child;
    if (!child) return { ok: false, message: '后端尚未就绪，请先打开界面' };
    if (this.refreshWaiter) return { ok: false, message: '已有刷新在进行中' };
    const id = String(++this.refreshSeq);
    const outcome = new Promise<RefreshOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.refreshWaiter = null;
        resolve({ ok: false, message: '刷新超时，请打开界面查看结果' });
      }, timeoutMs);
      this.refreshWaiter = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
    });
    child.postMessage({ command: 'refresh', id });
    return outcome;
  }

  /** 通知后端保存并退出，超时后强制结束进程；最后停止内嵌数据库。 */
  async stop(): Promise<void> {
    const child = this.child;
    if (child) {
      this.stopping = true;
      const closed = new Promise<void>((resolve) => {
        this.stopWaiter = resolve;
      });
      child.postMessage({ command: 'stop' });
      // 收到 stopped 说明数据已保存，此时只等进程自然退出；超时才强制结束。
      const outcome = await Promise.race([
        closed.then(() => 'closed' as const),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), STOP_TIMEOUT_MS)),
      ]);
      if (outcome === 'timeout' && this.child) {
        console.error('后端未在超时内退出，强制结束进程');
        this.child.kill();
      }
      this.child = null;
      this.endpoint = null;
    }
    // 后端已断开连接后再停数据库，避免连接池持有未提交事务。
    await this.database.stop();
  }
}
