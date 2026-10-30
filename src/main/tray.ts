import { app, Menu, Notification, Tray, nativeImage, shell, type MenuItemConstructorOptions } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Backend } from './backend';
import { log, logFilePath } from './log';

/**
 * 托盘与系统通知：替代旧的 C# 托盘程序。
 *
 * 菜单功能与 docs/tray-app.md 对齐：打开主界面 / 刷新数据 / 查看日志 / 开机启动 / 退出。
 * 刷新通过 utilityProcess 的消息协议触发，完成后用系统通知反馈结果。
 */

export interface TrayOptions {
  backend: Backend;
  /** 显示并聚焦主窗口 */
  show: () => void;
}

export function createTray({ backend, show }: TrayOptions): Tray {
  const iconPath = join(app.getAppPath(), 'assets', 'icon.ico');
  const tray = new Tray(existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty());
  tray.setToolTip('QdiiHelp · 净值观察台');
  tray.setContextMenu(buildMenu(show));
  tray.on('click', show);
  return tray;

  function notify(title: string, body: string): void {
    if (!Notification.isSupported()) {
      log(`通知不可用：${title} ${body}`);
      return;
    }
    new Notification({ title, body }).show();
  }

  async function refresh(): Promise<void> {
    const outcome = await backend.refresh();
    log('托盘刷新：' + outcome.message);
    notify(outcome.ok ? (outcome.warning ? '刷新完成（部分失败）' : '刷新完成') : '刷新未完成', outcome.message);
    tray.setContextMenu(buildMenu(show));
  }

  function buildMenu(onShow: () => void): Menu {
    const startup = app.getLoginItemSettings().openAtLogin;
    const template: MenuItemConstructorOptions[] = [
      { label: '打开 QdiiHelp', click: onShow },
      {
        label: '刷新数据',
        click: () => {
          tray.setContextMenu(buildMenu(onShow));
          void refresh();
        },
      },
      { type: 'separator' },
      {
        label: '查看运行日志',
        click: () => {
          void shell.openPath(logFilePath());
        },
      },
      {
        label: '开机启动（登录后）',
        type: 'checkbox',
        checked: startup,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked });
          log('开机启动已' + (item.checked ? '开启' : '关闭'));
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit(),
      },
    ];
    return Menu.buildFromTemplate(template);
  }
}
