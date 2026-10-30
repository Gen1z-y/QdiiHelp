import { ref } from 'vue';
import type { FundGroup, FundItem } from '@/types/fund';
import { inFundGroup, latestPublication, latestPublishedDate, hasPublishedReturn } from '@/lib/format';

/**
 * 卡片未读小圆点：沿用旧页面的 localStorage 约定（qdii-seen），
 * 保证用户从旧版本升级后已读状态不丢。key 为 `分组:代码`，历史数据可能只有代码。
 */

interface SeenState {
  actual?: string;
  pendingActual?: string;
  holdings?: string;
  dotTestUnread?: boolean;
}

const STORAGE_KEY = 'qdii-seen';

function load(): Record<string, SeenState> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, SeenState>;
  } catch {
    return {};
  }
}

const seen = ref<Record<string, SeenState>>(load());

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen.value));
  } catch {
    // 隐私模式或配额不足时忽略，读态不是关键数据。
  }
}

const keyOf = (f: FundItem, group: FundGroup): string => group + ':' + f.code;
const stateOf = (f: FundItem, group: FundGroup): SeenState | undefined =>
  seen.value[keyOf(f, group)] ?? seen.value[f.code];

/** 缺涨跌的公布日期要单独记住，等补全后仍能提醒。 */
function rememberIncomplete(f: FundItem, state: SeenState): void {
  const row = latestPublication(f);
  if (row && !hasPublishedReturn(row) && row.date >= (state.actual ?? '') && row.date > (state.pendingActual ?? '')) {
    state.pendingActual = row.date;
  }
}

export function useReadState() {
  /** 首次渲染时补齐缺失的基准，避免旧版本迁移后一次性刷出一片圆点。 */
  function initialize(funds: FundItem[]): void {
    let changed = false;
    for (const fund of funds) {
      for (const group of ['held', 'watch', 'bond'] as FundGroup[]) {
        if (!inFundGroup(fund, group)) continue;
        const saved = stateOf(fund, group);
        const next: SeenState = { ...saved };
        if (!saved || (saved.dotTestUnread && !saved.actual)) next.actual = latestPublishedDate(fund);
        delete next.dotTestUnread;
        rememberIncomplete(fund, next);
        if (JSON.stringify(next) !== JSON.stringify(saved)) {
          seen.value[keyOf(fund, group)] = next;
          changed = true;
        }
      }
    }
    if (changed) persist();
  }

  function unseen(f: FundItem, group: FundGroup): boolean {
    const state = stateOf(f, group);
    if (!state) return false;
    const date = latestPublishedDate(f);
    return !!date && (date > (state.actual ?? '') || date === state.pendingActual);
  }

  function markSeen(f: FundItem | undefined, group: FundGroup): void {
    if (!f) return;
    const state: SeenState = { ...stateOf(f, group) };
    const actual = latestPublishedDate(f);
    if (actual > (state.actual ?? '')) state.actual = actual;
    if (actual && actual >= (state.pendingActual ?? '')) delete state.pendingActual;
    rememberIncomplete(f, state);
    if ((f.latestHoldings?.asOf ?? '') > (state.holdings ?? '')) state.holdings = f.latestHoldings?.asOf ?? undefined;
    delete state.dotTestUnread;
    seen.value[keyOf(f, group)] = state;
    persist();
  }

  return { initialize, unseen, markSeen };
}
