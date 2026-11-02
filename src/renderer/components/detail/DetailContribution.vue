<script setup lang="ts">
import { computed } from 'vue';
import { contributionPanel } from '@/lib/estimate';

/**
 * 持仓贡献表：复用 src/shared/forecast-details.ts 的表格输出，
 * 区间切换、行情过滤与分页按钮由详情弹窗统一事件委托处理。
 */
const props = defineProps<{
  rows: unknown[];
  mode: 'daily' | 'cumulative';
  holdingsDate: string;
  page: number;
  filter: string;
}>();

const html = computed(() => contributionPanel(props.rows, props.mode, props.holdingsDate, props.page, props.filter));
</script>

<template>
  <section class="contributionPanel">
    <div v-if="html" v-html="html" />
    <p v-else class="muted">暂无可用于贡献分析的持仓数据。</p>
  </section>
</template>

<style lang="scss" scoped>
.muted {
  margin: 0;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}
</style>
