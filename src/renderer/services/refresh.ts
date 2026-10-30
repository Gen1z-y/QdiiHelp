import type { RefreshRun } from '@/types/refresh';
import { api } from './client';

/** 后台刷新任务列表（brief=1 只带失败项，减少传输）。 */
export async function fetchRefreshRuns(brief = true): Promise<{ runs: RefreshRun[] }> {
  return api<{ runs: RefreshRun[] }>(`/api/refresh${brief ? '?brief=1' : ''}`);
}

/** 只重试失败的基金。 */
export function retryRefresh(id: string): Promise<unknown> {
  return api<unknown>(`/api/refresh/${encodeURIComponent(id)}/retry`, { method: 'POST', body: '{}' });
}

/** 重新执行一次整组刷新。 */
export function repeatRefresh(group: string | null): Promise<unknown> {
  return api<unknown>('/api/refresh', { method: 'POST', body: JSON.stringify({ group }) });
}
