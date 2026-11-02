import type { FundGroup, FundItem, NavRow, SortMode } from '@/types/fund';
import { forecastInputs } from './estimate';

/** 百分比：0.0123 → +1.23%，非有限值显示破折号。 */
export function pct(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
    : '—';
}

/** 定点小数，缺省 4 位（净值口径）。 */
export function num(value?: number | null, digits = 4): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

/** 涨跌配色类名。 */
export function color(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return value > 0 ? 'up' : value < 0 ? 'down' : '';
}

/** 时间戳格式化为本地时间（Asia/Shanghai），用于状态栏与详情。 */
export function time(value?: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
}

/** 该行是否构成一条可用于展示/统计的正式涨跌。 */
export function hasPublishedReturn(row?: NavRow | null): boolean {
  return (
    !!row &&
    typeof row.value === 'number' &&
    Number.isFinite(row.value) &&
    row.value > 0 &&
    (Number.isFinite(row.dailyReturn) || Number.isFinite(row.intervalReturn))
  );
}

/** 单日优先，缺失时退化为区间涨跌。 */
export function navReturnValue(row?: NavRow | null): number | undefined {
  if (Number.isFinite(row?.dailyReturn)) return row?.dailyReturn ?? undefined;
  return Number.isFinite(row?.intervalReturn) ? (row?.intervalReturn ?? undefined) : undefined;
}

/** 最近一次可用的公布净值（可能是 latestNav 或 record.actual）。 */
export function latestPublication(f: FundItem): NavRow | undefined {
  return [f.latestNav, f.record?.actual]
    .filter(
      (row): row is NavRow =>
        !!row && /^\d{4}-\d{2}-\d{2}$/.test(row.date ?? '') && Number.isFinite(row.value) && (row.value ?? 0) > 0,
    )
    .sort((a, b) => b.date.localeCompare(a.date) || Number(hasPublishedReturn(b)) - Number(hasPublishedReturn(a)))[0];
}

export function latestPublishedDate(f: FundItem): string {
  const row = latestPublication(f);
  return hasPublishedReturn(row) ? (row?.date ?? '') : '';
}

/** 正式涨跌标签：单日 / 公布区间 / 假期后公布。 */
export function navReturnLabel(row?: NavRow | null): string {
  return !Number.isFinite(row?.dailyReturn) &&
    Number.isFinite(row?.intervalReturn) &&
    row?.returnPeriod !== 'fund-valuation'
    ? '公布区间涨跌'
    : '正式涨跌';
}

export function navReturnDate(row?: NavRow | null, date = ''): string {
  const to = row?.returnTo ?? row?.date ?? date;
  const from = row?.returnFrom ?? row?.previousDate;
  return !Number.isFinite(row?.dailyReturn) && Number.isFinite(row?.intervalReturn) && from && from !== to
    ? from + ' → ' + to
    : to;
}

export function navReturnSourceNote(row?: NavRow | null): string {
  if (row?.returnSource === '公布净值计算') return '由相邻公布净值计算';
  return row?.returnSource ? row.returnSource + ' · 同日净值已核对' : '';
}

export const inFundGroup = (f: FundItem, group: FundGroup): boolean =>
  group === 'bond' ? !!f.bond : (f.group ?? 'watch') === group;

export const fundTypeClass = (f: FundItem): string =>
  f.bond ? 'bondcard' : f.index || f.indexQuote ? 'indexcard' : 'stockcard';

export function fundMatches(f: FundItem, query: string): boolean {
  return !query || f.code.includes(query) || f.name.toLowerCase().includes(query);
}

/** 债基盘中参考：只有目标日国内已收盘且三个指数都到位时才算有效参考。 */
export function bondReferenceState(
  f: FundItem,
  now: Date = new Date(),
): { return: number | null; label: string; message: string } {
  const reference = f.bondReference;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const message =
    f.date > today
      ? '尚未到目标交易日'
      : f.domesticClosure || [0, 6].includes(new Date(f.date + 'T12:00:00Z').getUTCDay())
        ? '国内休市'
        : f.date === today && minutes < 570
          ? '国内市场未开盘'
          : reference?.unavailable;
  const current =
    !message &&
    Number.isFinite(reference?.return) &&
    !reference?.carried &&
    reference?.indexDate === f.date &&
    ['000012', '000013', '000832'].every((symbol) =>
      reference?.factors?.some(
        (factor) =>
          factor.symbol === symbol && factor.date === f.date && !factor.carried && Number.isFinite(factor.dayReturn),
      ),
    );
  return {
    return: current ? (reference?.return ?? null) : null,
    label: current ? (f.date === today && minutes < 900 ? '盘中参考' : '指数拟合参考') : (message ?? '等待指数行情'),
    message: current ? '指数拟合参考 · 等待收盘 / 公布' : (message ?? '等待目标日债券指数行情'),
  };
}

/** 卡片底部的一句话状态。 */
export function cardState(f: FundItem): string {
  if (f.refreshing) return '正在更新预估…';
  if (f.error || f.stale) return f.stale ? '刷新异常，保留上次结果' : '刷新失败，可重试';
  const actual = f.record?.actual;
  if (actual) {
    if (!hasPublishedReturn(actual)) return '净值已公布 · 涨跌幅待补全';
    if (Number.isFinite(actual.intervalReturn) && !Number.isFinite(actual.dailyReturn)) {
      return actual.returnPeriod === 'fund-valuation'
        ? (actual.returnReason ?? '假期') + '假期后公布 · 较上一公布净值'
        : '公布区间涨跌 · 单日涨跌未公布';
    }
    return actual.returnSource ? '涨跌幅已补全 · ' + actual.returnSource : '正式净值已公布';
  }
  if (f.navEstimate?.partial) return '阶段预估 · 行情截至 ' + (f.navEstimate.asOf ?? '待更新');
  if (f.navEstimate?.referenceOnly) return '区间参考 · 等待正式基准或估值安排确认';
  if (Number.isFinite(f.navEstimate?.return)) return '预估已保存 · 等待公布';
  if (f.bond) return bondReferenceState(f).message;
  if (/等待.*收盘|盘中|国内休市|休市.*不生成/.test(f.modelError ?? '')) return '等待收盘 / 公布';
  return '等待数据更新';
}

/** 排序比较器；manual 由后端顺序决定，不参与前端排序。 */
export function compareFunds(mode: SortMode, a: FundItem, b: FundItem): number {
  if (mode === 'estimate') {
    return (b.navEstimate?.return ?? -Infinity) - (a.navEstimate?.return ?? -Infinity);
  }
  if (mode === 'coverage') {
    return (forecastInputs(b)?.model?.coverage ?? -1) - (forecastInputs(a)?.model?.coverage ?? -1);
  }
  if (mode === 'pending') {
    return (
      Number(!hasPublishedReturn(b.record?.actual)) - Number(!hasPublishedReturn(a.record?.actual)) ||
      (b.navEstimate?.return ?? -Infinity) - (a.navEstimate?.return ?? -Infinity)
    );
  }
  return 0;
}
