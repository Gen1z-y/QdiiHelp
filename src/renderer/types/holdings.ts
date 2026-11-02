/** 持仓同步相关类型（对应后端 stockHoldingsReport 与 /api/holdings/* 的返回）。 */

export type HoldingsStatus = 'updated' | 'unchanged' | 'failed' | 'unsupported';

export interface HoldingsItem {
  code: string;
  name: string;
  status: HoldingsStatus;
  previousDate?: string | null;
  date?: string | null;
  count?: number;
  bonds?: { name: string; code: string; weight: number }[];
  message?: string;
  /** 同步后重新估算的结果说明 */
  calculationMessage?: string;
  recalculation?: 'updated' | 'published' | 'unavailable';
  syncedAt?: string;
  /** 与上一版持仓的对比（由后端 syncComparison 生成，交给 holdings-ui 渲染） */
  comparison?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HoldingsReport {
  items: HoldingsItem[];
  summary: Record<string, number>;
  serverTime?: string;
  refreshSummary?: { total: number; estimated: number; actual: number; unavailable: number };
  recalculation?: Record<string, number>;
  targetDate?: string;
  completedAt?: string;
}

export interface HoldingsProgress {
  completed: number;
  total: number | null;
  code?: string;
  name?: string;
  stage?: string;
  phase?: string;
}

export interface AnnouncementReport {
  url: string;
  title: string;
  publishedAt?: string;
}

export interface AnnouncementsResponse {
  periods: { asOf: string; reports: AnnouncementReport[] }[];
}
