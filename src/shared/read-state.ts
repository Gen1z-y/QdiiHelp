/**
 * 卡片红点（未读公布净值）状态机。
 *
 * 约定沿用旧页面 public/app.js 与 localStorage 的 qdii-seen / qdii-nav-alerts：
 * - 已读状态按「代码」保存，同时回写 held/watch/bond 三个分组 key，旧版本升级时状态不丢；
 * - 同一只基金在持有、自选、债基里共享已读进度；
 * - 红点只在「首次发现当天」显示，跨天后自动消失，避免长期挂着一个无人处理的红点。
 *
 * 纯函数实现（注入 storage 与当前日期），渲染层与 Node 测试共用。
 */

export interface ReadStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ReadStatePublication {
  date?: string;
  value?: number;
  dailyReturn?: number | null;
  intervalReturn?: number | null;
}

export interface ReadStateFund {
  code: string;
  group?: string;
  bond?: boolean;
  latestNav?: ReadStatePublication | null;
  record?: { actual?: ReadStatePublication | null } | null;
  latestHoldings?: { asOf?: string | null } | null;
}

export type FundGroupName = 'held' | 'watch' | 'bond';

interface SeenState {
  actual?: string;
  pendingActual?: string;
  holdings?: string;
  dotTestUnread?: boolean;
}

interface NavAlert {
  /** 触发提醒的公布净值日期 */
  date: string;
  /** 首次检测到的自然日（Asia/Shanghai） */
  day: string;
}

const SEEN_KEY = 'qdii-seen';
const ALERT_KEY = 'qdii-nav-alerts';
const GROUPS: FundGroupName[] = ['held', 'watch', 'bond'];

function parseRecord<T>(storage: ReadStateStorage, key: string): Record<string, T> {
  try {
    const value = JSON.parse(storage.getItem(key) ?? '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, T>) : {};
  } catch {
    return {};
  }
}

/** 该行是否构成一条可用于展示的正式涨跌。与 renderer/lib/format.ts 的判定保持一致。 */
function hasPublishedReturn(row?: ReadStatePublication | null): boolean {
  return (
    !!row &&
    typeof row.value === 'number' &&
    Number.isFinite(row.value) &&
    row.value > 0 &&
    (Number.isFinite(row.dailyReturn) || Number.isFinite(row.intervalReturn))
  );
}

/** 最近一次可用的公布净值（latestNav 或 record.actual）。 */
function latestPublication(fund: ReadStateFund): ReadStatePublication | undefined {
  return [fund.latestNav, fund.record?.actual]
    .filter(
      (row): row is ReadStatePublication =>
        !!row && /^\d{4}-\d{2}-\d{2}$/.test(row.date ?? '') && Number.isFinite(row.value) && (row.value ?? 0) > 0,
    )
    .sort(
      (a, b) =>
        (b.date ?? '').localeCompare(a.date ?? '') || Number(hasPublishedReturn(b)) - Number(hasPublishedReturn(a)),
    )[0];
}

function latestPublishedDate(fund: ReadStateFund): string {
  const row = latestPublication(fund);
  return hasPublishedReturn(row) ? (row?.date ?? '') : '';
}

/** 缺涨跌的公布日期要单独记住，等补全后仍能提醒。 */
function rememberIncomplete(fund: ReadStateFund, state: SeenState): void {
  const row = latestPublication(fund);
  if (!row || hasPublishedReturn(row)) return;
  const date = row.date ?? '';

  if (date >= (state.actual ?? '') && date > (state.pendingActual ?? '')) state.pendingActual = date;
}

export interface ReadState {
  /** 首次渲染时补齐缺失的基准，避免旧版本迁移后一次性刷出一片红点。 */
  initialize(funds: ReadStateFund[]): void;
  /** 是否需要显示红点（group 参数保留是为了调用点兼容，状态本身按基金共享）。 */
  unseen(fund: ReadStateFund, group?: string): boolean;
  /** 悬停或打开详情：记为已读，并同步三个分组。 */
  markSeen(fund: ReadStateFund | undefined, group?: string): void;
  /** 调试与测试用：当前持久化内容。 */
  snapshot(): Record<string, SeenState>;
}

export function createReadState({ storage, today }: { storage: ReadStateStorage; today?: () => string }): ReadState {
  const currentDay =
    today ??
    (() =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()));

  const seen = parseRecord<SeenState>(storage, SEEN_KEY);
  const alerts = parseRecord<NavAlert>(storage, ALERT_KEY);

  const keyOf = (fund: ReadStateFund, group: FundGroupName): string => group + ':' + fund.code;

  function persistSeen(): void {
    try {
      storage.setItem(SEEN_KEY, JSON.stringify(seen));
    } catch {
      // 隐私模式或配额不足时忽略，读态不是关键数据。
    }
  }

  function persistAlerts(): void {
    try {
      storage.setItem(ALERT_KEY, JSON.stringify(alerts));
    } catch {
      // 同上。
    }
  }

  /** 合并「代码」与三个分组的历史状态，每个字段取最新日期。 */
  function cardSeen(fund: ReadStateFund): SeenState | undefined {
    const states = [seen[fund.code], ...GROUPS.map((group) => seen[keyOf(fund, group)])].filter(
      (state): state is SeenState => !!state,
    );
    if (!states.length) return undefined;
    const merged: SeenState = Object.assign({}, ...states);
    for (const field of ['actual', 'holdings', 'pendingActual'] as const) {
      merged[field] = states
        .map((state) => state[field] ?? '')
        .sort()
        .at(-1);
    }
    if (!merged.holdings) delete merged.holdings;
    if (!merged.pendingActual || merged.pendingActual < (merged.actual ?? '')) delete merged.pendingActual;
    return merged;
  }

  /** 只在首次检测到该净值的那一天显示红点。 */
  function notificationActive(fund: ReadStateFund, date: string): boolean {
    const day = currentDay();
    const old = alerts[fund.code];
    if (!old || date > old.date) {
      alerts[fund.code] = { date, day };
      persistAlerts();
    }
    const current = alerts[fund.code];
    return current?.date === date && current.day === day;
  }

  function initialize(funds: ReadStateFund[]): void {
    let changed = false;
    for (const fund of funds) {
      const saved = cardSeen(fund);
      const next: SeenState = { ...saved };
      if (!saved || (saved.dotTestUnread && !saved.actual)) next.actual = latestPublishedDate(fund);
      delete next.dotTestUnread;
      rememberIncomplete(fund, next);
      if (JSON.stringify(next) !== JSON.stringify(seen[fund.code])) {
        seen[fund.code] = next;
        for (const group of GROUPS) seen[keyOf(fund, group)] = { ...next };
        changed = true;
      }
    }
    if (changed) persistSeen();
  }

  function unseen(fund: ReadStateFund): boolean {
    const state = cardSeen(fund);
    if (!state) return false;
    const date = latestPublishedDate(fund);
    return !!date && (date > (state.actual ?? '') || date === state.pendingActual) && notificationActive(fund, date);
  }

  function markSeen(fund: ReadStateFund | undefined): void {
    if (!fund) return;
    const state: SeenState = { ...cardSeen(fund) };
    const actual = latestPublishedDate(fund);
    if (actual > (state.actual ?? '')) state.actual = actual;
    if (actual && actual >= (state.pendingActual ?? '')) delete state.pendingActual;
    rememberIncomplete(fund, state);
    const holdingsDate = fund.latestHoldings?.asOf ?? '';
    if (holdingsDate > (state.holdings ?? '')) state.holdings = holdingsDate;
    delete state.dotTestUnread;
    seen[fund.code] = state;
    for (const group of GROUPS) seen[keyOf(fund, group)] = { ...state };
    persistSeen();
  }

  return {
    initialize,
    unseen: (fund) => unseen(fund),
    markSeen: (fund) => markSeen(fund),
    snapshot: () => JSON.parse(JSON.stringify(seen)) as Record<string, SeenState>,
  };
}
