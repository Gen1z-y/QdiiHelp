# 参与开发

## 开发环境

安装 Node.js 22+ 后执行 npm ci。界面开发优先使用 npm run preview，在 http://127.0.0.1:8790/ 查看模拟数据。

日常实例与开发实例应使用独立目录、不同端口和独立数据。不要为测试停止正在使用的服务，也不要让开发副本连接个人日常数据库。

## 测试

```powershell
npm test
```

默认运行单元和回归测试，PostgreSQL 集成测试跳过。部分测试会短暂启动本地端口或创建系统临时目录，运行前确认测试端口没有被其他服务占用。不要按进程名批量结束 Node.js。

默认测试前，请在当前终端清除可能继承的数据库测试/存储环境变量：

```powershell
Remove-Item Env:QDII_PG_TEST, Env:QDII_STORAGE, Env:QDII_DATA_FILE, Env:QDII_DATABASE_CONFIG -ErrorAction SilentlyContinue
npm test
```

仅在明确准备了专用测试数据库后运行集成测试，连接文件放在工程目录之外：

```powershell
$env:QDII_DATABASE_CONFIG = 'D:\qdii-test-private\database.json'
$env:QDII_PG_TEST = '1'
node --test test/postgres-store.test.mjs
```

将路径改为自己创建的配置。集成测试会在所连接的数据库中创建并清理临时 schema，需要相应权限；不要将它指向日常数据库。完成后关闭该测试终端，或清除相应环境变量。

## 提交内容

尽量保持改动聚焦，说明具体行为变化、复现方法和验证结果。修改估算时添加有意义的日期、缺行情或计算边界案例，避免只验证实现细节。

请先阅读[隐私检查](docs/privacy.md)。公开 PR 不包含私人配置、日志原文、数据库导出、截图和临时构建产物。

更改后端后，代码文件更新并不代表已经运行的服务加载了新版；由使用者主动保存并重启。静态页面更新通常刷新即可生效。
