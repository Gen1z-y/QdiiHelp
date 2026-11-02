import type { AnnouncementsResponse, HoldingsItem, HoldingsProgress, HoldingsReport } from '@/types/holdings';
import type { FundItem, FundsPayload } from '@/types/fund';
import { api, readLines } from './client';

/** 读取上一次持仓同步报告（不触发同步）。 */
export function fetchHoldingsReport(): Promise<HoldingsReport> {
  return api<HoldingsReport>('/api/holdings/sync');
}

/** 同步全部持仓并重新估算（NDJSON 流，进度事件带 phase: holdings | recalculate）。 */
export async function syncAllHoldings(
  onProgress: (progress: HoldingsProgress) => void,
): Promise<HoldingsReport & { data?: FundsPayload }> {
  let result: (HoldingsReport & { data?: FundsPayload }) | null = null;
  await readLines(
    '/api/holdings/sync',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream: true, date: 'auto' }),
    },
    (line) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as {
        type: string;
        error?: string;
        progress?: HoldingsProgress;
        data?: HoldingsReport & { data?: FundsPayload };
      } & Partial<HoldingsProgress>;
      if (event.type === 'error') throw new Error(event.error ?? '持仓同步失败');
      if (event.type === 'progress') onProgress(event as HoldingsProgress);
      if (event.type === 'result' && event.data) result = event.data;
    },
  );
  if (!result) throw new Error('同步连接中断，请重试');
  return result;
}

/** 单只基金同步持仓（NDJSON 流，stage 为中文阶段说明）。 */
export async function syncOneHolding(
  code: string,
  onProgress: (progress: HoldingsProgress) => void,
): Promise<{ sync: HoldingsItem; item?: FundItem }> {
  let result: { sync: HoldingsItem; item?: FundItem } | null = null;
  await readLines(
    '/api/holdings/sync-one',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, stream: true }) },
    (line) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as {
        type: string;
        error?: string;
        data?: { sync: HoldingsItem; item?: FundItem };
      } & Partial<HoldingsProgress>;
      if (event.type === 'error') throw new Error(event.error ?? '同步失败');
      if (event.type === 'progress') onProgress(event as HoldingsProgress);
      if (event.type === 'result' && event.data) result = event.data;
    },
  );
  if (!result) throw new Error('同步连接中断，请重试');
  return result;
}

/** 指定披露期的公告原文（可能较慢，单独放宽超时）。 */
export function fetchAnnouncements(
  code: string,
  date: string,
  previousDate?: string | null,
): Promise<AnnouncementsResponse> {
  const params = new URLSearchParams({ code, date });
  if (previousDate) params.set('previousDate', previousDate);
  return api<AnnouncementsResponse>(`/api/holdings/announcements?${params.toString()}`);
}
