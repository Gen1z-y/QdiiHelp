import { computed, ref } from 'vue';
import type { CompareMode, CompareResult } from '@/types/compare';
import { fetchComparison } from '@/services/compare';
import { useFunds } from './useFunds';
import { compareStatusText } from '@/lib/compare-chart';

/**
 * 基金对比状态（模块级单例）。
 * 2–8 只基金，按区间拉取历史净值做累计/单日涨跌对比，与旧页面一致。
 */

const MAX_COMPARE = 8;

const comparing = ref<string[]>([]);
const query = ref('');
const days = ref(90);
const mode = ref<CompareMode>('cumulative');
const result = ref<CompareResult | null>(null);
const loading = ref(false);
const status = ref('请选择2–8只基金开始对比');
const opened = ref(false);
const sliderIndex = ref(0);

let version = 0;

const { items } = useFunds();

/** 选择器里可见的基金（按搜索过滤）。 */
const pickable = computed(() => {
  const normalized = query.value.trim().toLowerCase();
  return items.value.filter(
    (fund) => !normalized || fund.code.includes(normalized) || fund.name.toLowerCase().includes(normalized),
  );
});

const selectedFunds = computed(() => items.value.filter((fund) => comparing.value.includes(fund.code)));

async function load(force = false): Promise<void> {
  if (comparing.value.length < 2) {
    version += 1;
    result.value = null;
    status.value = '请选择2–8只基金开始对比';
    return;
  }
  const token = ++version;
  loading.value = true;
  status.value = '正在逐页获取历史净值，首次下载可能需要几十秒…';
  try {
    const data = await fetchComparison(comparing.value, days.value, force);
    if (token !== version) return;
    result.value = data;
    sliderIndex.value = Math.max(0, data.dates.length - 1);
    status.value = compareStatusText(data);
  } catch (failure) {
    if (token !== version) return;
    result.value = null;
    status.value = '历史数据加载失败：' + (failure instanceof Error ? failure.message : String(failure));
  } finally {
    if (token === version) loading.value = false;
  }
}

/** 勾选/取消一只基金；超过 8 只时给出提示而不是静默忽略。 */
function toggle(code: string): boolean {
  if (comparing.value.includes(code)) {
    comparing.value = comparing.value.filter((item) => item !== code);
    void load();
    return true;
  }
  if (comparing.value.length >= MAX_COMPARE) {
    status.value = '最多同时对比8只基金，请先取消已选基金。';
    return false;
  }
  comparing.value = [...comparing.value, code];
  void load();
  return true;
}

function remove(code: string): void {
  comparing.value = comparing.value.filter((item) => item !== code);
  void load();
}

function setDays(next: number): void {
  days.value = next;
  void load();
}

function setMode(next: CompareMode): void {
  mode.value = next;
}

async function open(): Promise<void> {
  opened.value = true;
  query.value = '';
  await load();
}

function close(): void {
  opened.value = false;
}

export function useCompare() {
  return {
    comparing,
    query,
    days,
    mode,
    result,
    loading,
    status,
    opened,
    sliderIndex,
    pickable,
    selectedFunds,
    load,
    toggle,
    remove,
    setDays,
    setMode,
    open,
    close,
  };
}
