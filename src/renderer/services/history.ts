import type { DetailHistory } from '@/types/fund';
import { requestJson } from './client';

/**
 * 详情页的历史净值：format=detail 一次带回完整净值序列与统计。
 * 首次拉取可能较慢，超时放宽到 10 分钟（与旧页面一致）。
 */
export function fetchDetailHistory(code: string, withValidation = false): Promise<DetailHistory> {
  const url = `/api/history?format=detail&codes=${encodeURIComponent(code)}` + (withValidation ? '&validation=1' : '');
  return requestJson<DetailHistory>(url, {}, 600000);
}
