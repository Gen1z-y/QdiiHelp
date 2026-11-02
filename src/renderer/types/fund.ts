/**
 * 渲染层数据模型。
 * 字段来源：server.mjs 的 decorate()（后端返回的基金条目）与 lib/*.mjs 的统计结构。
 * 只声明界面会用到的字段，未知字段保持可选，避免后端扩展时类型报错。
 */

export type FundGroup = 'held' | 'watch' | 'bond';

export interface NavRow {
  date: string;
  value?: number;
  dailyReturn?: number | null;
  intervalReturn?: number | null;
  returnFrom?: string;
  returnTo?: string;
  returnSource?: string;
  returnPeriod?: string;
  returnReason?: string;
  previousDate?: string;
  cumulativeNav?: number;
  adjustment?: boolean;
}

export interface NavEstimate {
  return?: number | null;
  from?: string;
  to?: string;
  asOf?: string;
  mode?: 'daily' | 'cumulative';
  partial?: boolean;
  referenceOnly?: boolean;
  provisional?: boolean;
  targetConfirmed?: boolean;
}

export interface ForecastRow {
  code?: string;
  name?: string;
  secid?: string;
  weight?: number;
  currency?: string;
  market?: string;
  rmbReturn?: number;
  dailyStock?: { return?: number };
  fx?: { return?: number; source?: string };
  marketStatus?: { state?: string; message?: string };
}

export interface Forecast {
  date?: string;
  base?: { date?: string; value?: number; provisional?: boolean };
  holdingsDate?: string;
  rows?: ForecastRow[];
  model?: { return?: number; dailyReturn?: number; coverage?: number; method?: string };
  calculatedAt?: string;
  fx?: { return?: number; source?: string };
  fit?: BondFit;
  validation?: Record<string, unknown>;
}

export interface FundRecord {
  actual?: NavRow | null;
  forecast?: Forecast | null;
  partialForecast?: Forecast | null;
  sealedAt?: string;
  firstForecastAt?: string;
  firstActualSeenAt?: string;
  rejectedForecasts?: unknown[];
  reconstruction?: unknown;
  indexClose?: IndexQuote;
}

export interface IndexQuote {
  id?: string;
  name?: string;
  date?: string;
  previousDate?: string;
  close?: number;
  previousClose?: number;
  dailyReturn?: number;
  source?: string;
  stale?: boolean;
  error?: string;
}

/** 新旧债基模型的滚动验证结果。 */
export interface BondValidation {
  count?: number;
  from?: string;
  to?: string;
  baselineMae?: number;
  candidateMae?: number;
}

export interface BondFit {
  coeffs?: number[];
  factors?: { symbol: string; name: string; date: string; dayReturn: number; carried?: boolean }[];
  samples?: number;
  r2?: number;
  method?: string;
  unavailable?: string;
  disclosure?: { asOf?: string; publishedAt?: string; categories?: { total?: number } };
  adaptive?: { reason?: string; validation?: BondValidation };
  validation?: BondValidation;
}

export interface BondReference extends BondFit {
  return?: number | null;
  carried?: boolean;
  indexDate?: string;
  method?: string;
}

export interface HoldingRow {
  code: string;
  name: string;
  secid?: string;
  weight: number;
  currency?: string;
  market?: string;
}

export interface HoldingsSnapshot {
  asOf: string | null;
  rows: HoldingRow[];
  source?: string;
  fetchedAt?: string;
  expanded?: boolean;
  expansionError?: string;
}

export interface StatsGroupWindow {
  count?: number;
  bias?: number;
  mae?: number;
  from?: string;
  to?: string;
}

export interface FundStats {
  pairedCount?: number;
  mae?: number;
  pairs?: { date: string; forecast?: number | null; actual?: number | null }[];
  groups?: { method?: string; windows?: StatsGroupWindow[] }[];
}

export interface Quality {
  level?: string;
  coverage?: number;
  reasons?: string[];
}

export interface FundItem {
  code: string;
  name: string;
  date: string;
  asOf?: string;
  group?: FundGroup;
  bond?: boolean;
  index?: boolean;
  indexQuote?: IndexQuote | null;
  navEstimate?: NavEstimate | null;
  record?: FundRecord;
  latestNav?: NavRow | null;
  latestHoldings?: HoldingsSnapshot | null;
  bondHoldings?: { asOf?: string; rows?: { code: string; name: string; weight: number }[] } | null;
  bondReference?: BondReference | null;
  modelError?: string | null;
  navWarning?: string | null;
  error?: string | null;
  stale?: boolean;
  refreshing?: boolean;
  quality?: Quality | null;
  stats?: FundStats;
  history?: { count: number; fetchedAt?: string; source?: string; stale?: boolean; error?: string };
  pendingPublications?: unknown[];
  plan?: {
    target?: string;
    from?: string;
    asOf?: string;
    partial?: boolean;
    notices?: { date: string; reason: string; uncertain?: boolean }[];
    todayStatus?: { noValuation?: boolean; reason?: string };
  } | null;
  valuationFx?: { return?: number; source?: string; base?: { date?: string }; target?: { date?: string } } | null;
  forecastFxDiffers?: boolean;
  holdingsReestimated?: boolean;
  domesticClosure?: unknown;
  allocation?: { stock?: number; date?: string } | null;
  challenger?: unknown;
  challengerError?: string | null;
  fromSaved?: boolean;
  refreshReused?: boolean;
  refreshComplete?: boolean;
  requestedDate?: string;
  marketProgress?: unknown[];
  stages?: { date: string; target?: string; referenceOnly?: boolean }[];
  officialPeriod?: unknown;
  clientGroup?: FundGroup;
}

/** 汇率展示块（首页只展示中国外汇交易中心的官方中间价）。 */
export interface FxSummary {
  date?: string;
  dailyReturn?: number | null;
  close?: number | null;
  closeDate?: string | null;
  previousClose?: number | null;
  previousDate?: string | null;
  carried?: boolean;
  source?: string | null;
  /** 官方来源标识：CFETS 表示中国外汇交易中心 */
  authority?: string;
  /** 官方页面地址，用于校验缓存是否来自官方 */
  sourceUrl?: string;
  /** 刷新失败但仍有官方缓存时的提示 */
  updateError?: string;
  error?: string;
  savedAt?: string;
}

export interface RefreshSummary {
  estimated: number;
  actual: number;
  unavailable: number;
}

/** 一次刷新的返回值。 */
export interface FundsPayload {
  date: string;
  items: FundItem[];
  serverTime: string;
  fx?: FxSummary | null;
  fxUpdating?: boolean;
  historySync?: boolean;
  summary?: RefreshSummary;
  recalculated?: boolean;
  cached?: boolean;
}

/** NDJSON 流中的进度事件。 */
export interface StreamProgress {
  completed: number;
  total: number | null;
  code?: string;
  name?: string;
  stage?: string;
  item?: FundItem;
  official?: {
    code: string;
    name: string;
    bond?: boolean;
    index?: boolean;
    group?: FundGroup;
    date: string;
    actual?: NavRow | null;
    latestNav?: NavRow;
  };
}

/** 历史净值后台同步状态。 */
export interface HistorySyncState {
  running: boolean;
  completed: number;
  total: number;
  errors: string[];
  fx?: FxSummary | null;
  fxUpdating?: boolean;
}

export type SortMode = 'manual' | 'estimate' | 'coverage' | 'pending';

/** 详情页的历史净值响应（/api/history?format=detail）。 */
export interface DetailHistory {
  code: string;
  name?: string;
  rows: NavRow[];
  stats: FundStats;
  fetchedAt?: string;
  fullFetchedAt?: string;
  source?: string;
  stale?: boolean;
  error?: string;
  totalCount?: number;
  /** 是否已带验证统计数据（准确性 tab 需要） */
  validationLoaded?: boolean;
}

export type DetailTab = 'overview' | 'chart' | 'contrib' | 'fit' | 'accuracy';
