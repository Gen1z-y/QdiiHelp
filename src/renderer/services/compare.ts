import type { CompareResult, MarketItem, MarketsResult } from '@/types/compare';
import { requestJson, readLines } from './client';

/** 多只基金的历史净值对比（首次下载可能较慢，超时放宽到 10 分钟）。 */
export function fetchComparison(codes: string[], days: number, force = false): Promise<CompareResult> {
  const query = `/api/history?days=${days}&codes=${codes.join(',')}` + (force ? '&refresh=1' : '');
  return requestJson<CompareResult>(query, {}, 600000);
}

export interface MarketsProgress {
  completed: number;
  total: number;
  item?: MarketItem;
}

/** 全球指数行情：NDJSON 流，逐条返回指数行情便于地图实时填充。 */
export async function streamMarkets(
  force: boolean,
  onProgress: (progress: MarketsProgress) => void,
): Promise<MarketsResult> {
  let result: MarketsResult | null = null;
  await readLines(`/api/global-markets?stream=1${force ? '&refresh=1' : ''}`, {}, (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as {
      type: string;
      error?: string;
      data?: MarketsResult;
      completed?: number;
      total?: number;
      item?: MarketItem;
    };
    if (event.type === 'error') throw new Error(event.error ?? '行情加载失败');
    if (event.type === 'progress' && event.total) {
      onProgress({ completed: event.completed ?? 0, total: event.total, item: event.item });
    }
    if (event.type === 'result' && event.data) result = event.data;
  });
  if (!result) throw new Error('数据传输中断');
  return result;
}
