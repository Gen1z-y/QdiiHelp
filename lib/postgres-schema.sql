CREATE TABLE IF NOT EXISTS app_settings (
 key text PRIMARY KEY, payload jsonb NOT NULL, content_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS funds (
 code text PRIMARY KEY CHECK (code ~ '^\d{6}$'), payload jsonb NOT NULL, content_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS observations (
 key text PRIMARY KEY, code text NOT NULL, nav_date date NOT NULL,
 payload jsonb NOT NULL, content_hash text NOT NULL
);
CREATE INDEX IF NOT EXISTS observations_fund_date ON observations(code,nav_date DESC);
CREATE TABLE IF NOT EXISTS fund_views (
 key text PRIMARY KEY, code text NOT NULL, nav_date date NOT NULL,
 payload jsonb NOT NULL, content_hash text NOT NULL
);
CREATE INDEX IF NOT EXISTS fund_views_fund_date ON fund_views(code,nav_date DESC);
CREATE TABLE IF NOT EXISTS holding_versions (
 id text PRIMARY KEY, code text NOT NULL, kind text NOT NULL, report_date date,
 snapshot_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS holdings_fund_date ON holding_versions(code,report_date DESC);
CREATE TABLE IF NOT EXISTS snapshot_blobs (
 hash text PRIMARY KEY, content bytea NOT NULL, raw_bytes integer NOT NULL,
 children text[] NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS nav_history (
 code text NOT NULL, nav_date date NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(code,nav_date)
);
CREATE TABLE IF NOT EXISTS history_metadata (
 code text PRIMARY KEY, payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_runs (
 id text PRIMARY KEY, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_settings IS '项目配置及共享状态；按顶层配置项保存基金列表、分组、当前持仓引用、汇率展示和最近同步报告等';
COMMENT ON COLUMN app_settings.key IS '配置项名称，对应应用状态的顶层字段，例如 version、watchlist、fundGroups、holdingsSnapshots';
COMMENT ON COLUMN app_settings.payload IS '配置项的 JSON 内容；大型明细以 $snapshot 哈希引用 snapshot_blobs';
COMMENT ON COLUMN app_settings.content_hash IS '应用序列化配置内容的 SHA-256，用于判断内容是否变化并减少重复写入；不等同于数据库 JSONB 文本的哈希';

COMMENT ON TABLE funds IS '基金资料缓存；持有或自选分组与展示顺序由 app_settings 中的 fundGroups 和 watchlist 保存';
COMMENT ON COLUMN funds.code IS '六位基金代码，保留前导零，例如 270023';
COMMENT ON COLUMN funds.payload IS '基金资料及获取时间，包含 profile.name、债券基金标识、资产配置和 fetchedAt 等';
COMMENT ON COLUMN funds.content_hash IS '应用序列化基金资料的 SHA-256，用于识别变化并增量写入';

COMMENT ON TABLE observations IS '按基金和净值归属日期保存的观察记录，包含预估、阶段预估、正式结果、封存时间及审计证据引用';
COMMENT ON COLUMN observations.key IS '观察记录唯一键，格式为六位基金代码:YYYY-MM-DD';
COMMENT ON COLUMN observations.code IS '观察记录所属的六位基金代码；历史记录可独立于当前关注列表保留';
COMMENT ON COLUMN observations.nav_date IS '基金净值归属日期，用于历史查询；不是数据下载日期或海外市场收盘的北京时间日期';
COMMENT ON COLUMN observations.payload IS '完整观察状态的 JSON 内容；forecast、partialForecast、evidence 等大型字段使用快照引用；sealedAt 标识预估封存';
COMMENT ON COLUMN observations.content_hash IS '应用序列化观察状态的 SHA-256，用于识别变化并增量写入';

COMMENT ON TABLE fund_views IS '按基金和目标净值日期保存的页面展示缓存；观察记录通过同键关联 observations，避免重复保存';
COMMENT ON COLUMN fund_views.key IS '页面缓存唯一键，格式为六位基金代码:YYYY-MM-DD，与 observations.key 对应';
COMMENT ON COLUMN fund_views.code IS '页面缓存所属的六位基金代码';
COMMENT ON COLUMN fund_views.nav_date IS '页面所展示的目标净值归属日期';
COMMENT ON COLUMN fund_views.payload IS '页面展示数据，包括基金名称、最新正式净值、基准、数据检查时间和异常提示；大型持仓或分析通过快照引用保存';
COMMENT ON COLUMN fund_views.content_hash IS '应用序列化页面缓存的 SHA-256，用于识别变化并增量写入';

COMMENT ON TABLE holding_versions IS '披露持仓版本索引；同一基金和披露日期可保留不同内容版本，明细存入 snapshot_blobs';
COMMENT ON COLUMN holding_versions.id IS '持仓版本唯一键，格式为基金代码:持仓类型:快照哈希';
COMMENT ON COLUMN holding_versions.code IS '持仓版本所属的六位基金代码';
COMMENT ON COLUMN holding_versions.kind IS '持仓类型：stock 表示股票持仓，bond 表示债券持仓';
COMMENT ON COLUMN holding_versions.report_date IS '持仓披露报告的截止日期，对应持仓 asOf；不是同步执行日期';
COMMENT ON COLUMN holding_versions.snapshot_hash IS '完整持仓快照的 SHA-256 引用，对应 snapshot_blobs.hash';
COMMENT ON COLUMN holding_versions.created_at IS '该持仓版本首次写入数据库的时间；采用带时区时间戳，历史迁移时不代表原始下载时间';

COMMENT ON TABLE snapshot_blobs IS '按内容哈希去重的 gzip 压缩快照库，用于保存持仓明细、估值输入、行情行和审计证据等大型内容';
COMMENT ON COLUMN snapshot_blobs.hash IS '压缩前 JSON 字节内容的 SHA-256，作为唯一标识并用于解压后的完整性校验';
COMMENT ON COLUMN snapshot_blobs.content IS 'gzip 压缩后的 JSON 字节；内容可能含指向其他快照的 $snapshot 引用';
COMMENT ON COLUMN snapshot_blobs.raw_bytes IS '压缩前 JSON 字节长度，用于解压完整性校验';
COMMENT ON COLUMN snapshot_blobs.children IS '此快照直接引用的子快照哈希列表，用于追踪依赖并安全清理无引用快照';

COMMENT ON TABLE nav_history IS '基金正式历史净值序列，按基金代码与净值日期唯一保存，用于历史曲线、收益对比及模型拟合';
COMMENT ON COLUMN nav_history.code IS '历史净值所属的六位基金代码';
COMMENT ON COLUMN nav_history.nav_date IS '正式净值的归属日期，对应 payload.date';
COMMENT ON COLUMN nav_history.payload IS '单日历史净值数据，包括单位净值 value、累计净值 cumulativeNav、涨跌幅 dailyReturn 和折算标识 adjustment；收益率用小数表示，0.01 表示 1%';

COMMENT ON TABLE history_metadata IS '历史净值序列的来源与同步元信息；具体日数据保存在 nav_history';
COMMENT ON COLUMN history_metadata.code IS '历史净值序列所属的六位基金代码';
COMMENT ON COLUMN history_metadata.payload IS '不含 rows 的历史序列元信息，包括 schema、fetchedAt、fullFetchedAt、source、stale 及错误信息等';

COMMENT ON TABLE sync_runs IS '持仓同步报告历史，记录各基金的更新结果、失败原因和汇总；同一次报告的单只重同步可更新原报告';
COMMENT ON COLUMN sync_runs.id IS '同步报告唯一标识，优先使用报告 serverTime；缺失时使用报告 JSON 内容的 SHA-256';
COMMENT ON COLUMN sync_runs.payload IS '同步报告 JSON 内容，包括 items、summary、serverTime 和可选估算统计；items.status 为 updated、unchanged、failed 或 unsupported';
COMMENT ON COLUMN sync_runs.created_at IS '该报告首次写入数据库的时间；报告实际发生时间以 payload.serverTime 为准';

CREATE TABLE IF NOT EXISTS quote_cache (
 key text PRIMARY KEY, content bytea NOT NULL, cached_at bigint NOT NULL, raw_bytes integer NOT NULL
);
CREATE INDEX IF NOT EXISTS quote_cache_age ON quote_cache(cached_at);
COMMENT ON TABLE quote_cache IS '持久化行情和汇率缓存，替代工程目录中的缓存文件；按过期时间和总容量清理';
COMMENT ON COLUMN quote_cache.key IS '缓存请求标识，包含行情品种、币种、日期或数据源地址';
COMMENT ON COLUMN quote_cache.content IS 'gzip 压缩的缓存 JSON，包含 key、data、time';
COMMENT ON COLUMN quote_cache.cached_at IS '缓存生成时刻，Unix 毫秒时间戳，用于有效期判断';
COMMENT ON COLUMN quote_cache.raw_bytes IS '压缩前缓存 JSON 字节长度，用于容量限制';

CREATE TABLE IF NOT EXISTS runtime_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, kind text NOT NULL,
 message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE runtime_logs IS '运行日志和回放审计提示；数据库持久化并定期保留最近记录';
COMMENT ON COLUMN runtime_logs.id IS '日志递增标识';
COMMENT ON COLUMN runtime_logs.kind IS '日志类别，例如 stdout、stderr、replay-audit 或 maintenance';
COMMENT ON COLUMN runtime_logs.message IS '日志正文，不保存数据库密码';
COMMENT ON COLUMN runtime_logs.created_at IS '日志入库时间';

CREATE TABLE IF NOT EXISTS app_backups (
 id text PRIMARY KEY, content bytea NOT NULL, checksum text NOT NULL,
 metadata jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE app_backups IS '数据库内的应用状态备份，包含基金记录及历史净值；用于操作回退，替代本地备份文件';
COMMENT ON COLUMN app_backups.id IS '备份唯一名称，兼容既有备份接口的日期、类型和随机标识格式';
COMMENT ON COLUMN app_backups.content IS 'gzip 压缩的 qdii-backup-v1 备份包';
COMMENT ON COLUMN app_backups.checksum IS '压缩备份字节的 SHA-256，用于读取前校验完整性';
COMMENT ON COLUMN app_backups.metadata IS '备份摘要，包括基金数、观察记录数、历史基金数、创建时间和类型';
COMMENT ON COLUMN app_backups.created_at IS '备份入库时间，旧备份原始时间保存在 metadata';

CREATE TABLE IF NOT EXISTS project_archives (
 path text PRIMARY KEY, content bytea NOT NULL, checksum text NOT NULL,
 raw_bytes bigint NOT NULL, modified_at timestamptz NOT NULL, archived_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE project_archives IS '工程目录清理前的旧数据、备份和检查输出归档；保存原文件字节，校验通过后才能删除源文件';
COMMENT ON COLUMN project_archives.path IS '原文件相对于工程目录的路径，使用正斜杠；禁止绝对路径和上级目录引用';
COMMENT ON COLUMN project_archives.content IS 'gzip 压缩的原文件字节，可恢复旧 JSON、归档、日志和备份';
COMMENT ON COLUMN project_archives.checksum IS '原文件字节的 SHA-256，用于迁移及恢复校验';
COMMENT ON COLUMN project_archives.raw_bytes IS '原文件字节长度';
COMMENT ON COLUMN project_archives.modified_at IS '原文件最后修改时间';
COMMENT ON COLUMN project_archives.archived_at IS '该文件入库归档的时间';
