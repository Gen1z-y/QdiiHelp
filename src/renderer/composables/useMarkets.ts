import { computed, ref } from 'vue';
import type { MarketItem } from '@/types/compare';
import { streamMarkets } from '@/services/compare';

/**
 * 全球指数行情（模块级单例）：打开弹窗时加载，逐条进度实时填充地图。
 * 只在打开或手动刷新时请求，不做定时轮询。
 */

const opened = ref(false);
const items = ref<MarketItem[]>([]);
const loading = ref(false);
const completed = ref(0);
const total = ref(0);
const status = ref('');

const failedCount = computed(() => items.value.filter((item) => item.error).length);

async function load(force = false): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  completed.value = 0;
  total.value = 0;
  status.value = '正在获取全球指数行情…';
  try {
    const data = await streamMarkets(force, (progress) => {
      completed.value = progress.completed;
      total.value = progress.total;
      status.value = `正在加载指数：${progress.completed} / ${progress.total}`;
      if (!progress.item) return;
      const list = [...items.value];
      const index = list.findIndex((item) => item.id === progress.item?.id);
      if (index < 0) list.push(progress.item);
      else list[index] = progress.item;
      items.value = list;
    });
    items.value = data.items;
    const failed = data.items.filter((item) => item.error).length;
    status.value = failed
      ? `已完成，${failed} 个指数未能更新，保留可用数据。`
      : `已加载 ${data.items.length} 个指数。点击“刷新行情”获取最新报价。`;
  } catch (failure) {
    status.value =
      '行情加载失败：' + (failure instanceof Error ? failure.message : String(failure)) + '，请点击刷新重试。';
  } finally {
    loading.value = false;
  }
}

function open(): void {
  opened.value = true;
  void load(false);
}

function close(): void {
  opened.value = false;
}

export function useMarkets() {
  return { opened, items, loading, completed, total, status, failedCount, load, open, close };
}
