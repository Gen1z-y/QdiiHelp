/** 基金对比与全球指数相关类型。 */

export interface ComparePoint {
  date?: string;
  cumulative?: number | null;
  daily?: number | null;
}

export interface CompareSeries {
  code: string;
  name: string;
  points: ComparePoint[];
  totalReturn?: number;
  maxDrawdown?: number;
  fetchedAt?: string;
  stale?: boolean;
  derivedDates?: string[];
}

export interface CompareResult {
  base: string;
  end: string;
  dates: string[];
  series: CompareSeries[];
}

export type CompareMode = 'cumulative' | 'daily';

export interface MarketQuote {
  close?: number;
  change?: number;
  date?: string;
  asOf?: string;
}

export interface MarketDisplay {
  quote?: MarketQuote;
  label?: string;
  kind?: string;
  pointLabel?: string;
}

export interface MarketItem {
  id: string;
  name: string;
  x: number;
  y: number;
  closing?: MarketQuote;
  display?: MarketDisplay;
  stale?: boolean;
  error?: string;
}

export interface MarketsResult {
  items: MarketItem[];
}
