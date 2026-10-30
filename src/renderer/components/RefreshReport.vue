<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRefreshReport } from '@/composables/useRefreshReport';

/**
 * 刷新报告：折叠面板展示最近一次刷新结果，失败时可只重试失败项或整组重跑。
 * 内容由 shared 的 refreshReport() 生成，按钮通过事件委托处理。
 */

const { latest, html, handleAction, start, stop } = useRefreshReport();
const open = ref(false);

function onClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const retry = target.closest('[data-retry-refresh]') as HTMLButtonElement | null;
  if (retry?.dataset.retryRefresh) {
    void handleAction(retry.dataset.retryRefresh, false, latest.value?.group ?? null);
    return;
  }
  const repeat = target.closest('[data-repeat-refresh]') as HTMLButtonElement | null;
  if (repeat) void handleAction(latest.value?.id ?? '', true, latest.value?.group ?? null);
}

onMounted(start);
onBeforeUnmount(stop);
</script>

<template>
  <details v-if="latest" class="refreshReport" :open="open" @toggle="open = ($event.target as HTMLDetailsElement).open">
    <div class="refreshReportBody" @click="onClick" v-html="html" />
  </details>
</template>

<style lang="scss" scoped>
.refreshReport {
  margin: 0;
  padding: $spacing-sm $spacing-lg;
  border-bottom: 1px solid $color-border;
  background: $color-surface;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.refreshReportBody :deep(summary) {
  cursor: pointer;
  color: $color-primary;
  font-size: $font-size-sm;
}

.refreshReportBody :deep(button) {
  margin-top: $spacing-xs;
  padding: $spacing-xs $spacing-md;
  border: 1px solid $color-border-strong;
  border-radius: $radius-sm;
  background: $color-surface;
  color: $color-primary;
  font-size: $font-size-xs;
}

.refreshReportBody :deep(table) {
  width: 100%;
  border-collapse: collapse;
}

.refreshReportBody :deep(th),
.refreshReportBody :deep(td) {
  padding: $spacing-xs $spacing-sm;
  border-bottom: 1px solid $color-border;
  text-align: left;
}

.refreshReportBody :deep(small) {
  display: block;
  color: $color-text-secondary;
}

.refreshReportBody :deep(.error) {
  color: $color-warning;
}
</style>
