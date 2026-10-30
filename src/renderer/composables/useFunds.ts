import { computed, ref } from 'vue';
import type { FundGroup, FundItem, FxSummary, HistorySyncState, SortMode, StreamProgress } from '@/types/fund';
import { addFund, fetchHistorySync, loadSavedFunds, removeFund, runFundStream, saveOrder } from '@/services/funds';
import { time } from '@/lib/format';

/**
 * 首页基金状态（模块级单例，跨组件共享）。
 *
 * 与旧页面保持一致的关键行为：
 * - 刷新走 NDJSON 流：先 snapshot 再逐只 progress，最后 result；
 * - sequence 令牌让被新请求取代的旧流不再写状态；
 * - 刷新结束后单独轮询 /api/history-sync，历史净值在后台补齐。
 */

const GROUP_LABEL: Record<FundGroup, string> = { held: '持有', watch: '自选', bond: '债基' };

const items = ref<FundItem[]>([]);
const activeDate = ref('auto');
const busy = ref(false);
const progress = ref<StreamProgress | null>(null);
const status = ref('准备读取…');
const notice = ref('');
const fx = ref<FxSummary | null>(null);
const fxUpdating = ref(false);
const historySync = ref<HistorySyncState | null>(null);
const historyText = ref('');
const activeGroup = ref<FundGroup>('held');
const sortMode = ref<SortMode>(readSort());
const query = ref('');
const sequence = ref(0);
const loading = ref(false);

function readSort(): SortMode {
  try {
    const saved = localStorage.getItem('qdii-sort');
    if (saved === 'estimate' || saved === 'coverage' || saved === 'pending' || saved === 'manual') return saved;
  } catch {
    // 忽略存储异常
  }
  return 'manual';
}

function setSort(next: SortMode): void {
  sortMode.value = next;
  try {
    localStorage.setItem('qdii-sort', next);
  } catch {
    // 忽略存储异常
  }
}

/** 单只基金增量写入（流式进度会逐只到达）。 */
function upsert(item: FundItem): void {
  const index = items.value.findIndex((fund) => fund.code === item.code);
  if (index >= 0) {
    const next = [...items.value];
    next[index] = { ...next[index], ...item };
    items.value = next;
    return;
  }
  items.value = [...items.value, item];
}

/** 读取本机已保存的结果；失败只影响提示，不清空已有数据。 */
async function loadSaved(): Promise<void> {
  loading.value = true;
  try {
    const data = await loadSavedFunds();
    items.value = data.items.map((fund) => ({ ...fund, refreshComplete: true }));
    activeDate.value = data.date;
    fx.value = data.fx ?? null;
    status.value = data.items.length ? '已显示保存的结果，点击“刷新数据”更新' : '点击“刷新数据”获取基金数据';
  } catch (error) {
    notice.value = '无法读取保存的数据：' + (error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
}

/** 历史净值后台同步：运行中持续轮询，结束后把统计与历史合并回卡片。 */
async function watchHistorySync(seq: number, date: string, startedAt = Date.now()): Promise<void> {
  if (seq !== sequence.value) return;
  if (Date.now() - startedAt >= 600000) {
    historyText.value = '历史同步等待超过 10 分钟，已停止轮询；后台可能仍在继续，可稍后刷新查看';
    return;
  }
  try {
    const state = await fetchHistorySync();
    if (seq !== sequence.value) return;
    historySync.value = state;
    if (state.fx !== undefined) {
      fx.value = state.fx ?? null;
      fxUpdating.value = !!state.fxUpdating;
    }
    historyText.value = state.running
      ? `历史净值后台同步：${state.completed} / ${state.total} 只，当前预估已可查看`
      : state.errors.length
        ? '历史净值部分同步失败，已保留缓存：' + state.errors.join('；')
        : '历史净值同步完成';
    if (state.running || state.fxUpdating) {
      setTimeout(() => void watchHistorySync(seq, date, startedAt), 1500);
      return;
    }
    const saved = await loadSavedFunds(date);
    if (seq !== sequence.value) return;
    const fresh = new Map(saved.items.map((fund) => [fund.code, fund]));
    items.value = items.value.map((fund) => {
      const next = fresh.get(fund.code);
      return next ? { ...fund, history: next.history, stats: next.stats } : fund;
    });
  } catch (error) {
    historyText.value = '历史同步状态暂不可用：' + (error instanceof Error ? error.message : String(error));
  }
}

/** 刷新：force 会重新取行情并计算，group 只刷新一个分组。 */
async function refresh(options: { force?: boolean; group?: FundGroup | null } = {}): Promise<void> {
  const force = options.force === true;
  const group = options.group ?? null;
  if (busy.value) return;
  const seq = ++sequence.value;
  busy.value = true;
  notice.value = '';
  progress.value = { completed: 0, total: null };
  status.value = force ? '正在重新取行情并计算预估，请稍候…' : '获取净值、持仓与收盘行情…';
  try {
    const data = await runFundStream({
      force,
      group,
      onSnapshot: (snapshot) => {
        if (seq !== sequence.value || group) return;
        if (!snapshot.items.length) return;
        items.value = snapshot.items;
        activeDate.value = snapshot.date;
        status.value = '已显示本机保存的结果，正在更新行情…';
      },
      onProgress: (event) => {
        if (seq !== sequence.value) return;
        progress.value = event;
        if (event.item) upsert(event.item);
      },
      onOfficial: (official) => {
        if (seq !== sequence.value) return;
        const existing = items.value.find((fund) => fund.code === official.code);
        upsert({
          ...existing,
          code: official.code,
          name: official.name,
          bond: official.bond,
          index: official.index,
          group: official.group,
          date: official.date,
          record: { ...existing?.record, ...(official.actual ? { actual: official.actual } : {}) },
          latestNav: official.latestNav ?? existing?.latestNav ?? null,
          refreshing: true,
        } as FundItem);
      },
    });
    if (seq !== sequence.value) return;

    if (group) {
      const updated = new Map(data.items.map((fund) => [fund.code, fund]));
      const merged = items.value.map((fund) => updated.get(fund.code) ?? fund);
      for (const fund of data.items) if (!merged.some((item) => item.code === fund.code)) merged.push(fund);
      items.value = merged;
      status.value = `${GROUP_LABEL[group]}刷新完成 · ${data.items.length} 只 · ${time(data.serverTime)}`;
    } else {
      items.value = data.items;
      status.value = force
        ? `重新计算完成 ${time(data.serverTime)} · 有效预估 ${data.summary?.estimated ?? 0} 只，实际已公布 ${data.summary?.actual ?? 0} 只，暂不可估算 ${data.summary?.unavailable ?? 0} 只`
        : '';
    }
    activeDate.value = data.date;
    if (data.fx !== undefined) fx.value = data.fx;
    fxUpdating.value = !!data.fxUpdating;

    if (!force && !group) {
      const reused = data.items.filter((fund) => fund.refreshReused).length;
      status.value =
        (status.value ? status.value + ' · ' : '刷新完成 · ') +
        `${reused} 只复用已获取结果，${data.items.length - reused} 只已检查更新`;
    }

    const failures = data.items.filter((fund) => fund.error);
    if (failures.length) notice.value = failures.map((fund) => `${fund.code}：${fund.error}`).join('；');
    void watchHistorySync(seq, data.date);
  } catch (error) {
    if (seq !== sequence.value) return;
    const message = error instanceof Error ? error.message : String(error);
    notice.value = '更新失败：' + message;
    status.value = '刷新失败，稍后重试';
    historyText.value = '刷新失败：' + message;
  } finally {
    if (seq === sequence.value) {
      busy.value = false;
      progress.value = null;
    }
  }
}

/** 新增基金后立即刷新，让卡片出现结果。 */
async function add(code: string, group: 'held' | 'watch'): Promise<void> {
  await addFund(code, group);
  activeGroup.value = group;
  await refresh();
}

async function remove(code: string): Promise<void> {
  await removeFund(code);
  await refresh();
}

/** 手动排序：只在同分组内与相邻一只交换，再由后端持久化。 */
async function move(code: string, group: FundGroup, step: number): Promise<void> {
  if (sortMode.value !== 'manual' || query.value.trim()) return;
  const codes = items.value.map((fund) => fund.code);
  const index = codes.indexOf(code);
  const peers = items.value.filter((fund) => (group === 'bond' ? !!fund.bond : (fund.group ?? 'watch') === group));
  const at = peers.findIndex((fund) => fund.code === code);
  const neighbor = peers[at + step];
  const target = neighbor ? codes.indexOf(neighbor.code) : -1;
  if (index < 0 || target < 0 || target >= codes.length) return;
  [codes[index], codes[target]] = [codes[target], codes[index]];
  await saveOrder(codes);
  const byCode = new Map(items.value.map((fund) => [fund.code, fund]));
  items.value = codes.map((item) => byCode.get(item)).filter((item): item is FundItem => !!item);
}

/** 分组内可见基金（含搜索与排序）。 */
const groupedFunds = computed(() => {
  const normalized = query.value.trim().toLowerCase();
  const byGroup = {} as Record<FundGroup, FundItem[]>;
  for (const group of ['held', 'watch', 'bond'] as FundGroup[]) {
    byGroup[group] = [];
  }
  for (const fund of items.value) {
    for (const group of ['held', 'watch', 'bond'] as FundGroup[]) {
      if (group === 'bond' ? !fund.bond : (fund.group ?? 'watch') !== group) continue;
      if (normalized && !fund.code.includes(normalized) && !fund.name.toLowerCase().includes(normalized)) continue;
      byGroup[group].push(fund);
    }
  }
  return byGroup;
});

const metrics = computed(() => {
  const published = items.value.filter(
    (fund) => !!fund.record?.actual && Number.isFinite(fund.record.actual.value) && (fund.record.actual.value ?? 0) > 0,
  );
  const held = published.filter((fund) => (fund.group ?? 'watch') === 'held').length;
  return {
    total: items.value.length,
    predicted: items.value.filter((fund) => Number.isFinite(fund.navEstimate?.return)).length,
    published: published.length,
    publishedHeld: held,
    publishedWatch: published.length - held,
  };
});

export function useFunds() {
  return {
    items,
    metrics,
    groupedFunds,
    activeDate,
    busy,
    progress,
    status,
    notice,
    fx,
    fxUpdating,
    historyText,
    activeGroup,
    sortMode,
    query,
    loading,
    loadSaved,
    refresh,
    add,
    remove,
    move,
    setSort,
  };
}
