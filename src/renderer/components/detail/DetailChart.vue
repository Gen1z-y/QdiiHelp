<script setup lang="ts">
import { computed } from 'vue';
import type { FundItem, NavRow } from '@/types/fund';
import { detailHistoryChart } from '@/lib/estimate';

/**
 * 涨跌历史图：直接复用 src/shared/forecast-chart.ts 的 SVG 输出（已被 Node 测试覆盖），
 * 图内按钮（区间 / 周期-累计）由详情弹窗统一事件委托处理。
 */
const props = defineProps<{
  fund: FundItem;
  pairs: unknown[];
  days: number;
  mode: 'periodic' | 'cumulative';
  rows: NavRow[];
  loading: boolean;
  error: string;
}>();

/** 已公布净值只有不晚于目标日期的才参与绘图。 */
const published = computed(() =>
  [props.fund.record?.actual, props.fund.latestNav].filter(
    (row): row is NavRow => !!row?.date && row.date <= props.fund.date,
  ),
);

const html = computed(() =>
  detailHistoryChart(props.pairs, props.days, props.mode, props.rows, published.value, props.fund.stages ?? []),
);
</script>

<template>
  <section class="chartPanel">
    <p v-if="loading" class="muted">正在获取历史净值…</p>
    <p v-else-if="error" class="note">{{ error }}</p>
    <div v-html="html" />
  </section>
</template>

<style lang="scss" scoped>
.chartPanel {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}

.muted {
  margin: 0;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.note {
  margin: 0;
  color: $color-warning;
  font-size: $font-size-xs;
}
</style>
