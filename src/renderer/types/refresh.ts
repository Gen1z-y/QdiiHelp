/** 后台刷新任务（对应 lib/refresh-tasks.mjs 的记录）。 */

export type RefreshStatus = 'running' | 'complete' | 'partial' | 'failed' | 'interrupted';

export interface RefreshRunItem {
  code: string;
  name?: string;
  status?: string;
  error?: string;
  warning?: string;
  estimated?: boolean;
  published?: boolean;
}

export interface RefreshRun {
  id: string;
  status: RefreshStatus;
  source?: string;
  group?: string | null;
  date?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  counts?: { total?: number; updated?: number; cached?: number; failed?: number; unavailable?: number };
  progress?: { completed?: number; total?: number; code?: string; name?: string; stage?: string };
  items?: RefreshRunItem[];
  brief?: boolean;
}
