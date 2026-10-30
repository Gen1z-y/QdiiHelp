# QdiiHelp

本地运行的基金净值观察与学习工具：估算 QDII 股票基金、指数基金与部分债券基金的净值涨跌，正式净值公布后按日期核对，并分析历史走势与披露持仓。

桌面应用由 Electron 承载，**内置 PostgreSQL**，安装后即可使用，不需要另外安装数据库。仓库提供源码与模拟测试数据，不包含作者的数据库、关注列表、私人配置、运行日志或历史备份。

## 能做什么

- 按持有、自选、债基分组管理基金，手动刷新全部或指定分组。
- 获取公开披露持仓，结合行情与汇率计算参考估值，展示覆盖率、数据日期及缺失原因。
- 记录公布前的估算，正式净值公布后按日期核对，查看样本误差与历史校准参考。
- 查看历史净值、基金对比、全球指数，导出带水印的结果图片。
- 将业务状态、快照、行情缓存、日志与备份存入本机 PostgreSQL。
- 托盘常驻：后台刷新、开机启动、系统通知，关窗收进托盘。

估值受披露滞后、费用、汇率口径和数据源可用性影响；部分基金会暂停估算。它用于学习与观察，不承诺准确率，也不提供交易执行功能。

## 技术栈与结构

| 位置 | 内容 |
| --- | --- |
| `src/main/` | Electron 主进程：窗口、托盘、内嵌 PostgreSQL 与后端进程托管 |
| `src/preload/` | 极薄 preload（当前仅暴露版本号） |
| `src/renderer/` | Vue 3 + TypeScript + SCSS 界面：组件、composables、services、类型 |
| `src/shared/` | 前后端共用的纯逻辑（图表、明细面板、持仓 UI、假期导出），Node 测试直接引用 |
| `server.mjs` + `lib/` | 本地 HTTP 服务与业务逻辑：行情/净值抓取、估值模型、PostgreSQL 存储 |
| `desktop/bootstrap.cjs` | 后端进程引导：CJS 引导 ESM 服务，支持 Electron parentPort 与 stdin 双模协议 |
| `test/` | 后端与共享逻辑的回归测试，以及模拟数据预览夹具 |

前端与后端通过 `127.0.0.1` 上的同源 HTTP 通信；开发期由 Vite 代理转发 `/api`。

## 快速开始

需要 Node.js 22 或以上版本：

```powershell
npm ci
npm run dev
```

首次启动会自动初始化内置数据库（`initdb` 约 5–15 秒），之后启动只需一两秒。数据保存在 `%APPDATA%/QdiiHelp/`，安装包与源码运行共用同一位置。

只想看界面、不想碰真实数据：

```powershell
npm run build
npm run preview
```

打开 [模拟体验页面](http://127.0.0.1:8790/)，使用人工构造的基金数据与模拟行情，状态写入系统临时目录。

## 打包

```powershell
npm run dist
```

产物在 `release/`：`win-unpacked/QdiiHelp.exe`（免安装）与 NSIS 安装包。未配置代码签名时 Windows 会提示「未知发布者」。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [安装与首次启动](docs/getting-started.md) | 环境、启动、数据位置、连接已有 PostgreSQL、常见问题 |
| [日常操作](docs/user-guide.md) | 添加基金、刷新、同步持仓、历史与误差 |
| [源码学习](docs/architecture.md) | 目录、请求流程、估算口径与阅读顺序 |
| [桌面端与托盘](docs/tray-app.md) | 构建、托盘菜单、数据目录、卸载行为 |
| [隐私与公开发布](docs/privacy.md) | 上传范围、私人文件、提交前检查 |
| [参与开发](CONTRIBUTING.md) | 隔离预览、测试、提交说明 |

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装依赖 |
| `npm run dev` | 开发模式：Vite HMR + Electron + 内嵌后端 |
| `npm run build` | 构建主进程 / preload / 渲染层到 `out/` |
| `npm run dist` | 构建并打包 Windows 安装程序到 `release/` |
| `npm run preview` | 8790 端口模拟体验（需先 `npm run build`） |
| `npm start` | 只启动后端 HTTP 服务（默认 8787），便于接口调试 |
| `npm test` | 后端与共享逻辑测试（PostgreSQL 集成用例按环境自动跳过） |
| `npm run typecheck` | TypeScript 检查（渲染层 + 主进程） |
| `npm run format` / `npm run lint` | oxfmt 格式化 / oxlint 检查 |
| `npm run db:migrate -- <state.json 绝对路径>` | 为空库或外部数据库导入初始状态，不覆盖已有记录 |

程序默认只监听 `127.0.0.1`。当前没有多用户账户或面向公网的鉴权体系，请按本机工具使用。公开源码不等于公开个人运行实例。

## 数据来源与限制

程序按功能使用东方财富/天天基金、腾讯、NAVER、Frankfurter/ECB 等外部数据源；它们可能延迟、限流或不可用。仓库不附带个人运行时下载的数据集。源码许可证不授予第三方数据的再分发权，使用和再分发数据前需另行确认相应来源的条件。

## 许可证

项目源码采用 [MIT License](LICENSE)。第三方依赖保留各自的许可证。
