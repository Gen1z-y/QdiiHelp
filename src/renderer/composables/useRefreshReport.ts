import { computed, ref } from 'vue';
import type { RefreshRun } from '@/types/refresh';
import { fetchRefreshRuns, repeatRefresh, retryRefresh } from '@/services/refresh';
import { loadSavedFunds } from '@/services/funds';
import { refreshReport } from '@shared/request.ts';
import { useFunds } from './useFunds';

/**
 * 后台刷新报告：每 3 秒轮询任务状态（页面隐藏时暂停），
 * 有新的完成记录时把结果同步到卡片，与旧页面 mountOperations 行为一致。
 */

const runs = ref<RefreshRun[]>([]);
const latest = computed<RefreshRun | null>(() => runs.value[0] ?? null);
const html = computed(() => (latest.value ? (refreshReport(latest.value as never) as string) : ''));

const funds = useFunds();
let lastApplied = '';
let polling = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** 刷新完成后把服务端保存的结果拉回卡片。 */
async function applyRun(run: RefreshRun): Promise<boolean> {
  try {
    const saved = await loadSavedFunds(run.date);
    funds.items.value = saved.items.map((fund) => ({ ...fund, refreshComplete: true }));
    funds.activeDate.value = saved.date;
    if (saved.fx !== undefined) funds.fx.value = saved.fx;
    const failures = saved.items.filter((fund) => fund.error);
    funds.notice.value = failures.map((fund) => `${fund.code}：${fund.error}`).join('；');
    funds.status.value = run.source === 'tray' ? `托盘刷新结果已同步 · ${run.finishedAt ?? ''}` : funds.status.value;
    return true;
  } catch {
    return false;
  }
}

async function poll(): Promise<void> {
  if (polling || (typeof document !== 'undefined' && document.hidden)) return;
  polling = true;
  try {
    const data = await fetchRefreshRuns(true);
    runs.value = data.runs;
    const finished = data.runs
      .filter((run) => run.finishedAt && (run.status === 'complete' || run.status === 'partial'))
      .sort((left, right) => (left.finishedAt ?? '').localeCompare(right.finishedAt ?? ''));
    const newest = finished.at(-1);
    if (!newest) return;
    const token = `${newest.id}:${newest.finishedAt}`;
    if (token === lastApplied) return;
    // 用户正在刷新或正在看别的日期时不打断当前视图。
    if (funds.busy.value) return;
    if (funds.activeDate.value && newest.date && funds.activeDate.value !== newest.date) {
      lastApplied = token;
      return;
    }
    if (await applyRun(newest)) lastApplied = token;
  } catch {
    // 轮询失败不打扰用户，下一轮再试。
  } finally {
    polling = false;
  }
}

/** 只重试失败项 / 重新执行整组刷新。 */
async function handleAction(id: string, repeat: boolean, group: string | null): Promise<void> {
  if (repeat) await repeatRefresh(group);
  else await retryRefresh(id);
  await poll();
}

function start(): void {
  if (timer) return;
  void poll();
  timer = setInterval(() => void poll(), 3000);
  document.addEventListener('visibilitychange', onVisibility);
}

function onVisibility(): void {
  if (!document.hidden) void poll();
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisibility);
}

export function useRefreshReport() {
  return { runs, latest, html, poll, handleAction, start, stop };
}
