import { app, BrowserWindow, session, shell } from 'electron';
import { join } from 'node:path';
import { Backend } from './backend';
import { migrateUserData } from './data-migration';
import { log } from './log';
import { Database, stopDatabaseAt } from './postgres';
import { createTray } from './tray';

/**
 * Electron 主进程入口。
 *
 * 渲染层始终加载内嵌后端在 127.0.0.1 上分配的地址（同源 HTTP），
 * 因此前端可以沿用 fetch('/api/...')、现有 Host 校验与 CSP。
 * 后端在独立 utilityProcess 中运行，退出时由这里统一编排“先保存、再退出”。
 */

// 打包后主进程是 ESM，直接用 import.meta.dirname 定位 preload（避免与打包注入的 __dirname 冲突）。
const moduleDir = import.meta.dirname;
// 显式声明应用名：userData 路径由它决定（package.json 的 productName 已设置，这里再加一层保险）。
app.setName('QdiiHelp');
const backend = new Backend();
let mainWindow: BrowserWindow | null = null;
let quitting = false;

/** 后端不可用时展示的最小提示页，避免白屏。 */
function fallbackPage(message: string): string {
  const html = `<body style="font:14px/1.7 'Segoe UI','Microsoft YaHei',sans-serif;padding:40px;color:#17365e">
      <h2>后端未能启动</h2>
      <p>${message}</p>
      <p style="color:#62748c">可在应用日志中查看详细错误；如果是首次使用，请先完成数据库配置。</p>
    </body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#edf0f7',
    title: '净值观察台 · QdiiHelp',
    webPreferences: {
      preload: join(moduleDir, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  // 关闭按钮收进托盘：后端与刷新任务继续运行，只有“退出”才真正结束进程。
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });

  // 公告等外链一律交给系统浏览器，禁止在应用内新开窗口。
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // 只允许停留在后端源，其余跳转交给系统浏览器。
  window.webContents.on('will-navigate', (event, url) => {
    const origin = backend.current?.url;
    if (!origin || !url.startsWith(origin)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // 页面加载状态是排障的关键信号（例如确认拿到了后端动态端口）。
  window.webContents.on('did-finish-load', () => {
    console.log('页面已加载：' + window.webContents.getURL());
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`页面加载失败（${code} ${description}）：${url}`);
  });

  mainWindow = window;
  return window;
}

/**
 * 启动后端并加载界面。
 * 开发期优先加载 electron-vite 的 dev server（带 HMR，通过代理访问 /api）；
 * 打包后由内嵌后端在同一源上提供构建产物。失败时落到提示页。
 */
/** 显示并聚焦主窗口；窗口已被关闭时重新打开。 */
function showMainWindow(): void {
  const window = mainWindow;
  if (!window) {
    void loadApp();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

async function loadApp(): Promise<void> {
  const window = mainWindow ?? createWindow();
  try {
    const endpoint = await backend.start();
    log('后端就绪：' + endpoint.url);
    const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
    await window.loadURL(devUrl ?? endpoint.url);
    window.show();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('后端启动失败：' + message);
    await window.loadURL(fallbackPage(message));
    window.show();
  }
}

// 后端意外退出：优先自动重启，重启次数用尽后提示用户。
backend.onUnexpectedExit = ({ code, willRestart }) => {
  console.error(`后端进程退出（code=${code}），将${willRestart ? '尝试重启' : '停止服务'}`);
  if (!willRestart) {
    void mainWindow?.loadURL(fallbackPage('后端进程已退出，请重启应用。'));
    return;
  }
  setTimeout(() => void loadApp(), 1000);
};

// 单实例：重复启动时聚焦已有窗口。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    // 一次性数据目录搬迁：旧版目录名 qdii-help → QdiiHelp（改名后 userData 路径变化）。
    const migration = await migrateUserData({
      appData: app.getPath('appData'),
      legacyName: 'qdii-help',
      targetName: 'QdiiHelp',
      stopLegacyInstance: stopDatabaseAt,
      log: (message) => console.log('[migrate] ' + message),
    });
    log(`数据目录迁移：${migration.status}（${migration.message}）`);
    // Windows 通知需要应用标识，否则系统通知会静默丢弃。
    app.setAppUserModelId('com.qdiihelp.desktop');
    // 本工具不需要摄像头、麦克风、定位等权限，一律拒绝。
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    await loadApp();
    createTray({ backend, show: showMainWindow });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void loadApp();
    });
  });

  // 退出前先让后端保存数据：utilityProcess 里的 shutdown() 会等待进行中的任务。
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    backend.quitting = true;
    // 先销毁窗口断开渲染层的 keep-alive 连接，否则 server.close() 会一直等下去。
    mainWindow?.destroy();
    mainWindow = null;
    void backend
      .stop()
      .catch((error: unknown) => console.error('后端关闭失败：' + String(error)))
      .finally(() => app.quit());
  });

  // 托盘常驻：窗口关闭后应用继续在后台运行，只有托盘“退出”或 before-quit 才结束进程。
  app.on('window-all-closed', () => {
    if (quitting) return;
    log('窗口已全部关闭，应用继续在托盘运行');
  });
}
