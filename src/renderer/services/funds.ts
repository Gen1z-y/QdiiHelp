import type { FundGroup, FundItem, FundsPayload, HistorySyncState, StreamProgress } from '@/types/fund';
import { api, readLines } from './client';

/** 读取本机已保存的结果（不触发上游请求）。 */
export function loadSavedFunds(date = 'auto'): Promise<FundsPayload> {
  return api<FundsPayload>(`/api/funds?date=${encodeURIComponent(date)}&cached=1`);
}

export interface StreamHandlers {
  /** 首帧快照：立即展示本机保存的结果，随后再更新行情。 */
  onSnapshot?: (payload: FundsPayload) => void;
  /** 单只基金或整体进度。 */
  onProgress?: (progress: StreamProgress) => void;
  /** 正式净值提前到达，用于先把已公布结果填进卡片。 */
  onOfficial?: (official: NonNullable<StreamProgress['official']>) => void;
}

export interface StreamOptions extends StreamHandlers {
  date?: string;
  force?: boolean;
  group?: FundGroup | null;
}

/**
 * 刷新数据：NDJSON 流，事件顺序为 snapshot → progress(含 item) → result。
 * force 走 /api/recalculate（重新取行情并计算），group 只刷新单个分组。
 */
export async function runFundStream(options: StreamOptions = {}): Promise<FundsPayload> {
  const { date = 'auto', force = false, group = null } = options;
  let result: FundsPayload | null = null;
  const consume = (line: string): void => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as {
      type: string;
      error?: string;
      data?: FundsPayload;
      item?: FundItem;
      official?: StreamProgress['official'];
    } & Partial<StreamProgress>;
    if (event.type === 'error') throw new Error(event.error ?? '刷新失败');
    if (event.type === 'snapshot' && event.data) options.onSnapshot?.(event.data);
    if (event.type === 'progress') {
      options.onProgress?.(event as unknown as StreamProgress);
      if (event.official) options.onOfficial?.(event.official);
    }
    if (event.type === 'result' && event.data) result = event.data;
  };
  await readLines(
    force
      ? '/api/recalculate'
      : `/api/funds?stream=1&date=${encodeURIComponent(date)}${group ? '&group=' + encodeURIComponent(group) : ''}`,
    force
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, stream: true }),
        }
      : {},
    consume,
  );
  if (!result) throw new Error('数据连接中断，请重新刷新');
  return result;
}

/** 历史净值后台同步状态。 */
export function fetchHistorySync(): Promise<HistorySyncState> {
  return api<HistorySyncState>('/api/history-sync');
}

export function addFund(code: string, group: 'held' | 'watch'): Promise<{ ok: boolean; group: string }> {
  return api<{ ok: boolean; group: string }>('/api/funds', { method: 'POST', body: JSON.stringify({ code, group }) });
}

export function removeFund(code: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/api/funds/${code}`, { method: 'DELETE' });
}

export function saveOrder(codes: string[]): Promise<{ codes: string[] }> {
  return api<{ codes: string[] }>('/api/order', { method: 'PUT', body: JSON.stringify({ codes }) });
}

export function fetchFundProfile(code: string): Promise<{ name: string }> {
  return api<{ name: string }>(`/api/fund-profile?code=${encodeURIComponent(code)}`);
}
