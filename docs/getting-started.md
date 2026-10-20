# 安装与首次启动

以下命令以 Windows PowerShell 为例。所有数据库名称和账户都是示例，请使用自己的配置；不要导入他人的运行数据。

## 1. 准备环境

- Node.js 22 或以上版本，附带 npm。
- 可正常连接的 PostgreSQL；程序使用 JSONB、事务和常规 SQL 表。
- Git 可选，也可以在仓库页面选择 Code → Download ZIP。
- Windows 托盘额外依赖 .NET Framework 4.x；命令行启动不依赖托盘。

检查 Node.js 与 npm：

```powershell
node --version
npm --version
```

进入解压后的 QdiiHelp 目录，安装依赖：

```powershell
npm ci
```

如果 PowerShell 提示禁止运行 npm.ps1，可使用 `npm.cmd ci` 和 `npm.cmd start` 等对应命令，无需修改系统执行策略。

## 2. 可选：先体验模拟界面

```powershell
npm run preview
```

打开 http://127.0.0.1:8790/。此模式不读取数据库配置、不连接真实数据库，并模拟外部行情请求。按 Ctrl+C 停止后再继续安装。

端口被占用时可在当前终端改用其他端口：

```powershell
$env:QDII_PREVIEW_PORT = '8791'
npm run preview
```

此时打开 http://127.0.0.1:8791/。不要为了预览停止不属于自己的进程。

## 3. 建立专用数据库

在 PostgreSQL 的 SQL Shell（psql）中，用有建库权限的账户连接；也可使用 pgAdmin 查询工具。以下 SQL 为示例：

```sql
CREATE ROLE qdiihelp_app LOGIN;
\password qdiihelp_app
CREATE DATABASE qdiihelp OWNER qdiihelp_app;
```

`\password` 是 psql 命令，会交互提示输入两次密码；在 pgAdmin 中请通过角色属性界面设置密码。若角色或数据库已经存在，不要重复创建，更不要删除已有数据库来完成安装。

应用账户需要在专用数据库中创建和访问表、索引。首次启动会执行 `lib/postgres-schema.sql`，不需要自己逐表建表。

## 4. 填写本地连接配置

在项目目录运行：

```powershell
Copy-Item config/database.example.json config/database.local.json
notepad config/database.local.json
```

按自己的连接信息填写，例如：

```json
{
  "host": "127.0.0.1",
  "port": 5432,
  "database": "qdiihelp",
  "user": "qdiihelp_app",
  "password": "replace-me",
  "max": 4,
  "connectionTimeoutMillis": 5000
}
```

`replace-me` 是占位符，必须换成刚才设置的密码。该文件被 Git 忽略，不要提交、截图或粘贴到公开 Issue。

可用以下命令独立检查连接，不会打印密码：

```powershell
node --input-type=module -e "import pg from 'pg'; import {databaseConfig} from './lib/database-config.mjs'; const c=new pg.Client(databaseConfig()); try { await c.connect(); console.log('数据库连接成功'); } finally { await c.end(); }"
```

## 5. 初始化全新的空数据库

当前版本使用旧格式导入命令完成首次初始化。下面在系统临时目录生成一个**空的示例状态**，不包含任何人的真实基金列表或持仓：

```powershell
$qdiiInitDir = Join-Path ([IO.Path]::GetTempPath()) ('qdii-initial-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $qdiiInitDir | Out-Null
$qdiiInitFile = Join-Path $qdiiInitDir 'state.json'
node --input-type=module -e "import fs from 'node:fs'; fs.writeFileSync(process.argv[1], JSON.stringify({version:1,watchlist:[],profiles:{},records:{},lastView:{}}));" $qdiiInitFile
npm run db:migrate -- $qdiiInitFile
```

成功时输出中包含 `"verified": true`。初始化目录还会生成迁移备份和核对报告，按需保存在自己电脑上，不要提交到仓库。

此步骤只对全新安装执行一次。已有数据库的日常启动不需要重复迁移。迁移工具遇到已有项目记录会拒绝导入；同端口服务仍在运行时也会拒绝迁移。程序提示“数据库尚未导入项目数据”时，检查是否完成此步骤，及连接文件是否指向刚初始化的数据库。

程序禁止把旧格式运行数据放到工程目录内，因此示例必须使用上述外部临时路径。

## 6. 启动真实服务

确认模拟体验已停止，运行：

```powershell
npm start
```

打开 http://127.0.0.1:8787/。页面最初没有基金是正常情况，请按[日常操作教程](user-guide.md)添加自己的基金。

命令行模式停止时按 Ctrl+C，等待保存完成。Windows 托盘可在首次安装完成后[另行构建](tray-app.md)。

需要修改端口时，在启动前设置：

```powershell
$env:PORT = '8792'
npm start
```

然后打开 http://127.0.0.1:8792/。不要让多个日常实例同时使用同一份业务数据库。

## 常见问题

| 现象 | 检查方法 |
| --- | --- |
| 找不到 node/npm | 安装 Node.js 22+，关闭并重新打开终端 |
| npm 安装失败 | 检查到 npm 软件源的网络连接、缓存目录权限 |
| 缺少数据库连接配置 | 确认存在 config/database.local.json，JSON 格式正确 |
| password authentication failed | 检查账户密码、数据库认证配置 |
| ECONNREFUSED | 检查 PostgreSQL 服务、地址和端口 |
| 数据库尚未导入项目数据 | 完成第 5 步，确认使用同一连接配置 |
| address already in use | 检查已有实例归属或换用自己的空闲端口 |
| start.cmd 找不到 EXE | 源码不附带 EXE，先构建托盘，或直接 npm start |
| 无法估算/接口超时 | 检查披露日期、行情缺失、数据源网络状态，不要把缺数据当作零收益 |

## 备份与更新

业务状态、缓存、日志和应用备份保存在 PostgreSQL 中；仅复制源码目录不能备份这些数据。应用内的回退备份与整个数据库的灾难恢复是不同用途，完整备份应使用自己的数据库运维流程。

更新前保留自己的数据库备份和本地配置。先在独立源码副本使用模拟数据验证，再更新日常目录；后端更新后由使用者主动保存并重启。不要覆盖仍在运行的 EXE。
