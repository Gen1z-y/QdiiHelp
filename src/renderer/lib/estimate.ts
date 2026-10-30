import {
  accuracyPanel as rawAccuracyPanel,
  contributionPanel as rawContributionPanel,
  dateStatus as rawDateStatus,
  estimateLabel as rawEstimateLabel,
  forecastInputs as rawForecastInputs,
  fundFxImpact as rawFundFxImpact,
  indexContributionRows as rawIndexContributionRows,
  intervalNote as rawIntervalNote,
  navPeriodLabel as rawNavPeriodLabel,
  observationPanel as rawObservationPanel,
  quoteStatusBadge as rawQuoteStatusBadge,
  reliability as rawReliability,
  reliabilityPanel as rawReliabilityPanel,
} from '@shared/forecast-details.ts';
import type { ForecastLike, ForecastStockRow, FundLike, FundStatsLike, FxImpact } from '@shared/forecast-details.ts';
import { detailHistoryChart as rawDetailHistoryChart } from '@shared/forecast-chart.ts';
import type { ChartMode, ChartPair, HistoryRow, PublishedRow, StageRow } from '@shared/forecast-chart.ts';
import type { FundItem, FundStats, NavRow } from '@/types/fund';

/**
 * 渲染层与 src/shared 纯逻辑模块之间的适配层。
 *
 * src/shared 已完成 TS 迁移并自带精确类型；渲染层的 FundItem 来自后端 JSON，
 * 个别字段（domesticClosure 等）仍是 unknown，这里统一做一次边界转换，
 * 避免每个调用点各写断言。返回 HTML 字符串的函数交给 v-html 渲染。
 */

/** 后端 JSON 与本层类型的边界转换：字段结构一致，仅 unknown 字段需在这里收口。 */
const asFund = (f: FundItem): FundLike => f as unknown as FundLike;
const asRows = (rows: unknown[]): ForecastStockRow[] => rows as unknown as ForecastStockRow[];

/** 估算所用的输入快照（预估明细、持仓日期与指数行情）。 */
export type ForecastInputs = ForecastLike;

/** 区间标签。 */
export function estimateLabel(f: FundItem): string {
  return rawEstimateLabel(asFund(f));
}

/** 估值区间的补充说明。 */
export function intervalNote(f: FundItem): string {
  return rawIntervalNote(asFund(f));
}

/** 净值区间文案（例如“9月1日至9月30日”）。 */
export function navPeriodLabel(interval: unknown, fallback = ''): string {
  return rawNavPeriodLabel((interval ?? {}) as { to?: string; from?: string; mode?: string }, fallback);
}

/** 数据检查：返回需要注意的问题与覆盖度。 */
export function reliability(f: FundItem): {
  attention: boolean;
  issues: string[];
  holdingDate?: string;
  coverage?: number;
} {
  return rawReliability(asFund(f));
}

/** 本次预估的输入快照，用于详情页展示估算依据。 */
export function forecastInputs(f: FundItem): ForecastInputs | null {
  return rawForecastInputs(asFund(f));
}

/** 估值区间与公布进度面板。 */
export function observationPanel(f: FundItem): string {
  return rawObservationPanel(asFund(f));
}

/** 持仓贡献表（含区间切换、行情过滤与分页，内部按钮由外层事件委托处理）。 */
export function contributionPanel(
  rows: unknown[],
  mode: 'daily' | 'cumulative' = 'daily',
  holdingsDate?: string | null,
  page = 1,
  filter = 'all',
): string {
  return rawContributionPanel(asRows(rows), mode, holdingsDate, page, filter);
}

/** 准确性统计面板。 */
export function accuracyPanel(stats?: FundStats): string {
  return rawAccuracyPanel(stats as unknown as FundStatsLike);
}

/** 数据检查（可靠性）面板。 */
export function reliabilityPanel(f: FundItem): string {
  return rawReliabilityPanel(asFund(f));
}

/** 指数基金的贡献行（假设全部跟踪指数）。 */
export function indexContributionRows(forecast: ForecastInputs | null): unknown[] {
  return rawIndexContributionRows(forecast);
}

/** 汇率对预估的贡献（百分点）。 */
export function fundFxImpact(f: FundItem): FxImpact | null {
  return rawFundFxImpact(asFund(f));
}

/** 行情来源徽标（指数详情使用）。 */
export function quoteStatusBadge(row: unknown): string {
  return rawQuoteStatusBadge(row as unknown as ForecastStockRow);
}

/** 自动日期状态说明。 */
export function dateStatus(f: FundItem, options: { automatic?: boolean; now?: Date } = {}): string {
  return rawDateStatus(asFund(f), options);
}

/** 涨跌历史图（SVG 字符串，带区间/模式按钮）。 */
export function detailHistoryChart(
  pairs: unknown[],
  days: number,
  mode: ChartMode,
  rows: NavRow[] = [],
  published: NavRow[] = [],
  stages: unknown[] = [],
): string {
  return rawDetailHistoryChart(
    pairs as unknown as ChartPair[],
    days,
    mode,
    rows as HistoryRow[],
    published as PublishedRow[],
    stages as StageRow[],
  );
}
