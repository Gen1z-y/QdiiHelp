import { app } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 主进程日志：同时写 stdout 与 userData/main.log。
 * 采用同步追加，确保启动失败、进程被强制结束时仍能留下线索。
 */

let logFile: string | null = null;

/** 日志文件路径（供托盘菜单打开）。 */
export function logFilePath(): string {
  return join(app.getPath('userData'), 'main.log');
}

export function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  try {
    if (!logFile) {
      const dir = app.getPath('userData');
      mkdirSync(dir, { recursive: true });
      logFile = join(dir, 'main.log');
    }
    appendFileSync(logFile, line, 'utf8');
  } catch {
    // 写日志失败不能影响主流程。
  }
}
