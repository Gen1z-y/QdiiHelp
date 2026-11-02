import { ref } from 'vue';
import type { FundGroup, FundItem } from '@/types/fund';
import { createReadState } from '@shared/read-state.ts';

/**
 * 卡片未读小圆点：状态机在 src/shared/read-state.ts（Node 测试直接覆盖），
 * 这里只负责浏览器存储接入，以及「红点只在发现当天有效」的响应式刷新。
 * localStorage 沿用旧页面的 qdii-seen / qdii-nav-alerts，升级后已读状态不丢。
 */

const engine = createReadState({
  storage: {
    getItem: (key: string) => localStorage.getItem(key),
    setItem: (key: string, value: string) => localStorage.setItem(key, value),
  },
});

/** 定时刷新版本号：跨天后 unseen 重新计算，红点自动消失。 */
const refreshTick = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

function onVisibility(): void {
  if (!document.hidden) refreshTick.value++;
}

/** 每秒检查一次与旧页面一致；页面隐藏时浏览器会节流，回到前台立即补一次。 */
function ensureTimer(): void {
  if (timer || typeof window === 'undefined') return;
  timer = setInterval(() => {
    refreshTick.value++;
  }, 1000);
  document.addEventListener('visibilitychange', onVisibility);
}

export function useReadState() {
  ensureTimer();

  /** 首次渲染时补齐缺失的基准，避免旧版本迁移后一次性刷出一片红点。 */
  function initialize(funds: FundItem[]): void {
    engine.initialize(funds);
    refreshTick.value++;
  }

  function unseen(fund: FundItem, group: FundGroup): boolean {
    // 读取 refreshTick 建立响应式依赖：跨天过期后卡片会重新计算红点。
    const active = engine.unseen(fund, group);
    return refreshTick.value >= 0 && active;
  }

  function markSeen(fund: FundItem | undefined, group: FundGroup): void {
    engine.markSeen(fund, group);
    refreshTick.value++;
  }

  return { initialize, unseen, markSeen };
}
