import { computed, ref } from 'vue';
import type { AnnouncementsResponse, HoldingsItem, HoldingsProgress, HoldingsReport } from '@/types/holdings';
import { fetchAnnouncements, fetchHoldingsReport, syncAllHoldings, syncOneHolding } from '@/services/holdings';
import {
  holdingsAnnouncementLinks,
  holdingsComparison,
  holdingsReadState,
  holdingsResultRow,
  holdingsUpdatedFunds,
  pageRows,
  pagination,
} from '@shared/holdings-ui.ts';
import { time } from '@/lib/format';
import { useFunds } from './useFunds';

/**
 * 持仓同步状态（模块级单例）。
 *
 * 与旧页面一致的行为：
 * - 全部同步会先拉持仓、再重估所有基金，进度分两个 phase；
 * - 单只同步只更新对应报告行与卡片；
 * - 表格行、分页按钮、只看有更新等按钮来自 shared 的 HTML 输出，用事件委托处理；
 * - 已读小圆点沿用 shared 的 holdingsReadState（localStorage）。
 */

const report = ref<HoldingsReport | null>(null);
const busy = ref(false);
const progress = ref<HoldingsProgress | null>(null);
const query = ref('');
const page = ref(1);
const updatedOnly = ref(false);
const opened = ref(false);
const error = ref('');

const changesItem = ref<HoldingsItem | null>(null);
const announcements = ref<AnnouncementsResponse | null>(null);
const announcementLoading = ref(false);
const announcementError = ref('');

const funds = useFunds();

const readState = holdingsReadState({
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
});

const filtered = computed(() => {
  const items = report.value?.items ?? [];
  const normalized = query.value.trim().toLowerCase();
  return items.filter(
    (row) =>
      (!updatedOnly.value || row.status === 'updated') &&
      (!normalized ||
        (row.name ?? '').toLowerCase().includes(normalized) ||
        (row.code ?? '').toLowerCase().includes(normalized)),
  );
});

const paged = computed(() => pageRows(filtered.value, page.value));

/** 表格行 HTML：每行是否带圆点由 shared 的已读状态决定。 */
const rowsHtml = computed(() => {
  const current = report.value;
  if (!current) return '';
  return paged.value.rows
    .map((row: HoldingsItem) => holdingsResultRow(row, current, readState.unseen(row, current)) as string)
    .join('');
});

const paginationHtml = computed(() => (report.value ? (pagination(paged.value, 'holdings') as string) : ''));

const updatedFundsHtml = computed(() =>
  report.value ? (holdingsUpdatedFunds(report.value.items, updatedOnly.value) as string) : '',
);

const summaryText = computed(() => {
  const current = report.value;
  if (!current) return '';
  const s = current.summary ?? {};
  return [
    `更新 ${s.updated ?? 0}`,
    `无变化 ${s.unchanged ?? 0}`,
    s.failed ? `失败 ${s.failed}` : '',
    s.unsupported ? `不适用 ${s.unsupported}` : '',
    current.refreshSummary ? `已刷新 ${current.refreshSummary.total} 只` : '',
  ]
    .filter(Boolean)
    .join(' · ');
});

const resultCount = computed(() =>
  report.value ? (updatedOnly.value ? filtered.value.length : (report.value.items?.length ?? 0)) : 0,
);

/** 打开展示前先读一次报告；没有报告时保持空态。 */
async function load(): Promise<void> {
  try {
    report.value = await fetchHoldingsReport();
    error.value = '';
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  }
}

async function open(): Promise<void> {
  opened.value = true;
  page.value = 1;
  query.value = '';
  updatedOnly.value = false;
  await load();
}

function close(): void {
  opened.value = false;
}

/** 全部同步：同步完成后卡片结果由返回的 data 覆盖。 */
async function syncAll(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  progress.value = { completed: 0, total: null, phase: 'holdings' };
  try {
    const result = await syncAllHoldings((state) => {
      progress.value = state;
    });
    report.value = result;
    if (result.data) {
      funds.items.value = result.data.items.map((fund) => ({ ...fund, fromSaved: false, refreshComplete: true }));
      funds.activeDate.value = result.data.date;
      if (result.data.fx !== undefined) funds.fx.value = result.data.fx;
    }
  } catch (failure) {
    error.value = '同步失败：' + (failure instanceof Error ? failure.message : String(failure));
  } finally {
    busy.value = false;
    progress.value = null;
  }
}

/** 单只同步：只更新对应报告行与卡片。 */
async function syncOne(code: string): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  progress.value = { completed: 0, total: 1, code, stage: '正在开始同步…' };
  try {
    const result = await syncOneHolding(code, (state) => {
      progress.value = { ...state, code: state.code ?? code };
    });
    if (result.sync) {
      const current = report.value ?? { items: [], summary: {}, serverTime: new Date().toISOString() };
      const items = [...current.items];
      const index = items.findIndex((row) => row.code === code);
      if (index >= 0) items[index] = { ...items[index], ...result.sync };
      else items.unshift(result.sync);
      const summary = Object.fromEntries(
        ['updated', 'unchanged', 'failed', 'unsupported'].map((status) => [
          status,
          items.filter((row) => row.status === status).length,
        ]),
      );
      report.value = { ...current, items, summary, serverTime: result.sync.syncedAt ?? current.serverTime };
    }
    if (result.item) {
      const list = [...funds.items.value];
      const index = list.findIndex((fund) => fund.code === code);
      if (index >= 0) list[index] = { ...list[index], ...result.item };
      else list.push(result.item);
      funds.items.value = list;
    }
    if (result.sync?.status === 'failed') error.value = '单独同步失败：' + (result.sync.message ?? '未知原因');
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
    progress.value = null;
  }
}

/** 行内「变化」：先渲染对比，再异步补充公告原文。 */
async function openChanges(row: HoldingsItem): Promise<void> {
  changesItem.value = row;
  announcements.value = null;
  announcementError.value = '';
  announcementLoading.value = true;
  try {
    const data = await fetchAnnouncements(row.code, String(row.date ?? ''), row.previousDate ?? null);
    if (changesItem.value?.code === row.code) announcements.value = data;
  } catch (failure) {
    if (changesItem.value?.code === row.code) {
      announcementError.value = failure instanceof Error ? failure.message : String(failure);
    }
  } finally {
    announcementLoading.value = false;
  }
}

function closeChanges(): void {
  changesItem.value = null;
  announcements.value = null;
  announcementError.value = '';
}

/** 行悬停/聚焦时标记已读，并移除圆点。 */
function markRow(code: string): void {
  const current = report.value;
  if (!current) return;
  const row = current.items.find((item) => item.code === code);
  if (!row || !readState.unseen(row, current)) return;
  readState.mark(row, current);
}

const changesHtml = computed(() => (changesItem.value ? (holdingsComparison(changesItem.value, true) as string) : ''));
const announcementsHtml = computed(() =>
  changesItem.value && announcements.value
    ? (holdingsAnnouncementLinks(announcements.value, changesItem.value) as string)
    : '',
);
const announcementListUrl = computed(() =>
  changesItem.value ? `https://fundf10.eastmoney.com/jjgg_${encodeURIComponent(changesItem.value.code)}_3.html` : '',
);
const changesMeta = computed(() => {
  const row = changesItem.value;
  if (!row) return '';
  return `${row.code} · 持仓截至 ${row.date ?? '—'}${row.previousDate ? ` · 上期 ${row.previousDate}` : ''}`;
});
const syncedAtText = computed(() => time(report.value?.serverTime));

export function useHoldings() {
  return {
    report,
    busy,
    progress,
    query,
    page,
    updatedOnly,
    opened,
    error,
    filtered,
    paged,
    rowsHtml,
    paginationHtml,
    updatedFundsHtml,
    summaryText,
    resultCount,
    syncedAtText,
    changesItem,
    changesHtml,
    changesMeta,
    announcements,
    announcementsHtml,
    announcementLoading,
    announcementError,
    announcementListUrl,
    load,
    open,
    close,
    syncAll,
    syncOne,
    openChanges,
    closeChanges,
    markRow,
  };
}
