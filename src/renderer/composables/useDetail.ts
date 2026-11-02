import { computed, ref } from 'vue';
import type { DetailHistory, DetailTab, FundItem } from '@/types/fund';
import { fetchDetailHistory } from '@/services/history';
import { useFunds } from './useFunds';

/**
 * 详情弹窗状态（模块级单例）。
 *
 * 与旧页面一致的行为：
 * - 每次打开都重置 tab / 贡献区间 / 图表区间；
 * - 历史净值按基金缓存（detailHistories），准确性 tab 首次进入时再补 validation 数据；
 * - 请求带 token，快速切换基金时旧响应不覆盖新状态。
 */

const selectedCode = ref<string | null>(null);
const tab = ref<DetailTab>('overview');
const contributionMode = ref<'daily' | 'cumulative'>('cumulative');
const quoteFilter = ref('all');
const chartDays = ref(90);
const chartMode = ref<'periodic' | 'cumulative'>('periodic');
const contributionPage = ref(1);
const histories = ref<Record<string, DetailHistory>>({});
const historyLoading = ref(false);
const historyError = ref('');

const tokens = new Map<string, symbol>();

const { items } = useFunds();

const fund = computed<FundItem | null>(() => {
  if (!selectedCode.value) return null;
  return items.value.find((item) => item.code === selectedCode.value) ?? null;
});

const history = computed<DetailHistory | null>(() =>
  selectedCode.value ? (histories.value[selectedCode.value] ?? null) : null,
);

/** 详情展示用的基金：历史统计到达后覆盖基础统计。 */
const detailFund = computed<FundItem | null>(() => {
  const current = fund.value;
  if (!current) return null;
  const cached = history.value;
  return cached?.stats ? { ...current, stats: cached.stats } : current;
});

const tabs = computed<{ id: DetailTab; label: string }[]>(() => {
  const current = detailFund.value;
  const shared: { id: DetailTab; label: string }[] = [
    { id: 'overview', label: '概览' },
    { id: 'chart', label: '涨跌历史' },
  ];
  const tail: { id: DetailTab; label: string }[] = [{ id: 'accuracy', label: '准确性' }];
  if (current?.bond) return [...shared, { id: 'fit', label: '拟合与持仓' }, ...tail];
  return [...shared, { id: 'contrib', label: '持仓贡献' }, ...tail];
});

/** 拉取历史净值；validation 用于准确性 tab 的模型验证数据。 */
async function ensureHistory(withValidation = false): Promise<void> {
  const code = selectedCode.value;
  if (!code) return;
  const cached = histories.value[code];
  if (cached && (!withValidation || cached.validationLoaded)) return;
  const token = Symbol(code);
  tokens.set(code, token);
  historyLoading.value = true;
  historyError.value = '';
  try {
    const data = await fetchDetailHistory(code, withValidation);
    if (tokens.get(code) !== token) return;
    histories.value = { ...histories.value, [code]: { ...data, validationLoaded: withValidation } };
  } catch (error) {
    if (tokens.get(code) !== token) return;
    historyError.value = '历史数据更新失败：' + (error instanceof Error ? error.message : String(error));
  } finally {
    if (tokens.get(code) === token) historyLoading.value = false;
  }
}

function open(code: string): void {
  selectedCode.value = code;
  tab.value = 'overview';
  contributionMode.value = 'cumulative';
  quoteFilter.value = 'all';
  chartDays.value = 90;
  chartMode.value = 'periodic';
  contributionPage.value = 1;
  historyError.value = '';
  void ensureHistory(false);
}

function close(): void {
  selectedCode.value = null;
  historyError.value = '';
}

/** 切换 tab；准确性需要额外的验证统计。 */
function selectTab(next: DetailTab): void {
  tab.value = next;
  if (next === 'accuracy') void ensureHistory(true);
}

/** 丢掉某只基金的历史缓存（持仓同步后需要重新取）。 */
function invalidate(code: string): void {
  if (!histories.value[code]) return;
  const next = { ...histories.value };
  delete next[code];
  histories.value = next;
}

export function useDetail() {
  return {
    selectedCode,
    tab,
    tabs,
    contributionMode,
    quoteFilter,
    chartDays,
    chartMode,
    contributionPage,
    history,
    historyLoading,
    historyError,
    fund,
    detailFund,
    open,
    close,
    selectTab,
    ensureHistory,
    invalidate,
  };
}
