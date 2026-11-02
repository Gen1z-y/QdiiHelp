import { contextBridge } from 'electron';

/**
 * Preload 保持极薄：渲染层主体仍走同源 HTTP，只有无法用 Web API 完成的
 * 桌面能力才经由 contextBridge 暴露（P5 会补 savePng / openLogs 等）。
 */
const desktopApi = {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
} as const;

contextBridge.exposeInMainWorld('desktop', desktopApi);

export type DesktopApi = typeof desktopApi;
