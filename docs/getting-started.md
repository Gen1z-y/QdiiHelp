# 安装与首次启动

QdiiHelp 是桌面应用（Electron），**内置 PostgreSQL**：安装后直接启动即可，不需要另外安装数据库、也不需要手动建库。

以下命令以 Windows PowerShell 为例。

## 1. 从源码运行

需要 Node.js 22 或以上版本（附带 npm）。

```powershell
node --version
npm ci
npm run dev
```

`npm run dev` 会同时启动 Vite 开发服务器、Electron 主进程和内嵌后端；首次启动会执行 `initdb`（约 5–15 秒），之后启动只需一两秒。

如果 PowerShell 提示禁止运行 npm.ps1，可使用 `npm.cmd run dev` 等对应命令，无需修改系统执行策略。

## 2. 安装包

```powershell
npm run dist
```

产物在 `release/`：

- `release/win-unpacked/QdiiHelp.exe`：免安装，可直接运行
- `release/QdiiHelp Setup x.y.z.exe`：NSIS 安装包

未配置代码签名时，Windows 会提示「未知发布者」，属正常现象。

## 3. 数据位置

| 内容 | 路径 |
| --- | --- |
| 内置数据库 | `%APPDATA%/QdiiHelp/pgdata` |
| 连接配置 | `%APPDATA%/QdiiHelp/database.json` |
| 主进程日志 | `%APPDATA%/QdiiHelp/main.log` |
| 数据库日志 | `%APPDATA%/QdiiHelp/postgres.log` |

卸载程序默认**不删除**该目录，重装后可继续使用原有数据。需要彻底清理时手动删除整个目录。

> 早期版本的目录名是 `%APPDATA%/qdii-help`（应用名取自 package.json 的 `name`）。现在应用名改为 `QdiiHelp`，目录随之变化；
> 启动时会自动把旧目录里的 `pgdata`、`database.json` 与日志**改名搬入**新目录并同步修正配置里的数据目录路径。
> 搬迁前若发现旧数据库仍在运行，会先尝试停止；停不掉就保持原状，绝不覆盖数据。

应用内也有回退备份（设置按钮在开发计划中），与数据库级灾难恢复是两件事：整体备份仍建议停机后复制上述目录。

## 4. 体验模式（不需要数据库）

```powershell
npm run build
npm run preview
```

打开 http://127.0.0.1:8790/ 。此模式使用人工构造的基金数据与模拟行情，状态写入系统临时目录，不读写你的数据库。按 Ctrl+C 停止。

端口被占用时：

```powershell
$env:QDII_PREVIEW_PORT = '8791'
npm run preview
```

## 5. 可选：连接已有 PostgreSQL

默认使用内置数据库。若要与团队共用或使用自己的实例：

1. 建库与账号（示例，勿直接复制密码）：

```sql
CREATE ROLE qdiihelp_app LOGIN;
\password qdiihelp_app
CREATE DATABASE qdiihelp OWNER qdiihelp_app;
```

2. 写入连接配置 `%APPDATA%/QdiiHelp/database.json`：

```json
{
  "host": "127.0.0.1",
  "port": 5432,
  "database": "qdiihelp",
  "user": "qdiihelp_app",
  "password": "replace-me",
  "max": 4,
  "connectionTimeoutMillis": 8000
}
```

3. 初始化空库（只需一次）：

```powershell
$qdiiInitDir = Join-Path ([IO.Path]::GetTempPath()) ('qdii-initial-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qdiiInitDir | Out-Null
$qdiiInitFile = Join-Path $qdiiInitDir 'state.json'
node --input-type=module -e "import fs from 'node:fs'; fs.writeFileSync(process.argv[1], JSON.stringify({version:1,watchlist:[],profiles:{},records:{},lastView:{}}));" $qdiiInitFile
npm run db:migrate -- $qdiiInitFile
```

输出包含 `"verified": true` 即成功。之后正常启动应用就会连到该库。

也可以改用环境变量指定配置路径，便于开发调试：

```powershell
$env:QDII_DATABASE_CONFIG = 'D:\my-config\database.json'
npm run dev
```

## 常见问题

| 现象 | 检查方法 |
| --- | --- |
| 找不到 node/npm | 安装 Node.js 22+，重开终端 |
| npm 安装失败 | 检查软件源网络与缓存目录权限 |
| 启动卡在「正在初始化数据库」 | 首次 `initdb` 需要几秒；失败时看 `postgres.log` |
| port 8787 / 5273 被占用 | 关闭占用的进程；后端端口可用 `QDII_DEV_BACKEND_PORT` 改 |
| password authentication failed | 外部数据库模式下检查账号密码 |
| ECONNREFUSED | 检查 PostgreSQL 是否启动、地址端口是否正确 |
| 数据库尚未导入项目数据 | 完成第 5 节第 3 步初始化 |
| 无法估算 / 接口超时 | 检查披露日期、行情缺失与数据源网络状态；不要把缺数据当作零收益 |

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 开发模式（Vite HMR + Electron） |
| `npm run build` | 构建主进程 / preload / 渲染层到 `out/` |
| `npm run typecheck` | TypeScript 检查（渲染层 + 主进程） |
| `npm run format` / `npm run lint` | oxfmt 格式化 / oxlint 检查 |
| `npm test` | 后端与共享逻辑测试（PostgreSQL 集成用例自动跳过） |
| `npm start` | 只启动后端 HTTP 服务，便于接口调试 |
