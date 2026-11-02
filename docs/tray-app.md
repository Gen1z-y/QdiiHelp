# 桌面端与托盘使用

当前桌面端由 Electron 承载：主进程负责窗口、托盘、内嵌 PostgreSQL 与后端进程，
渲染层是 Vue 3 界面。安装包内置数据库，首次启动会自动初始化，不需要另行安装 PostgreSQL。

## 运行方式

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 开发调试 | `npm run dev` | 启动 Vite 开发服务器与 Electron，主窗口加载带热更新的页面 |
| 本地构建 | `npm run build` | 产出 `out/main`、`out/preload`、`out/renderer` |
| 打包安装程序 | `npm run dist -- --win --x64`（或 `npm run dist`） | 产出 `release/` 下的 NSIS 安装包与免安装目录 |
| 仅调试后端 | `npm start` | 只启动 HTTP 服务（默认 8787），用于接口排查 |

`npm run dist` 会执行 `electron-builder`：内嵌 PostgreSQL 二进制会被复制到 `resources/pg/native`，
其余代码打进 `app.asar`。未配置代码签名时安装包会提示来源未知，属正常现象。

## 托盘菜单

| 菜单 | 用途 |
| --- | --- |
| 打开 QdiiHelp | 显示并聚焦主窗口 |
| 刷新数据 | 触发一次全部刷新，完成后用系统通知反馈结果 |
| 查看运行日志 | 打开 `userData/main.log` |
| 开机启动（登录后） | 勾选后写入当前用户登录启动项 |
| 退出 | 保存数据、停止后端与数据库后退出 |

关闭窗口只会收进托盘，应用继续在后台运行；需要彻底结束时请用托盘“退出”。

## 数据位置

- 数据库：`%APPDATA%/QdiiHelp/pgdata`（安装包内置实例）
- 连接配置：`%APPDATA%/QdiiHelp/database.json`
- 主进程日志：`%APPDATA%/QdiiHelp/main.log`；数据库日志：同目录 `postgres.log`

卸载程序默认**不删除**上述目录，重装后可继续使用原有数据；如需彻底清理请手动删除该目录。

## 说明

迁移前的 C# 托盘程序（`tray/`）已在本次改造中移除，现在只保留 Electron 托盘。
