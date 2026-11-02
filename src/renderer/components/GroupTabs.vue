<script setup lang="ts">
import type { FundGroup } from '@/types/fund';

/** 分组标签：持有 / 自选 / 债基，各自带单组刷新按钮。 */
const props = defineProps<{
  active: FundGroup;
  counts: Record<FundGroup, number>;
  busy: boolean;
}>();
const emit = defineEmits<{ select: [group: FundGroup]; refresh: [group: FundGroup] }>();

const groups: { key: FundGroup; label: string }[] = [
  { key: 'held', label: '持有' },
  { key: 'watch', label: '自选' },
  { key: 'bond', label: '债基' },
];

/** 方向键在三个标签之间循环，保持与旧页面一致的键盘可达性。 */
function onKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const order: FundGroup[] = ['held', 'watch', 'bond'];
  const index = order.indexOf(props.active);
  const next =
    event.key === 'Home'
      ? 'held'
      : event.key === 'End'
        ? 'bond'
        : event.key === 'ArrowRight'
          ? order[(index + 1) % order.length]
          : order[(index + order.length - 1) % order.length];
  emit('select', next);
}
</script>

<template>
  <div class="groupTabs" role="tablist" aria-label="基金分组" @keydown="onKeydown">
    <div v-for="item in groups" :key="item.key" class="groupTabItem">
      <button
        type="button"
        class="groupTab"
        :class="{ groupTabActive: active === item.key }"
        role="tab"
        :aria-selected="active === item.key"
        :tabindex="active === item.key ? 0 : -1"
        @click="emit('select', item.key)"
      >
        {{ item.label }}
        <span class="groupTabCount">{{ counts[item.key] }}</span>
      </button>
      <button
        type="button"
        class="groupTabRefresh"
        :disabled="busy"
        :title="'单独刷新' + item.label"
        :aria-label="'单独刷新' + item.label + '基金'"
        @click="emit('refresh', item.key)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M20 7v5h-5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M19 12a7 7 0 1 1-2.05-4.95L20 10" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.groupTabs {
  display: inline-flex;
  gap: $spacing-xs;
  align-items: center;
}

.groupTabItem {
  display: inline-flex;
  gap: 2px;
  align-items: center;
  padding: 3px 3px 3px 0;
  border: 1px solid $color-border;
  border-radius: $radius-pill;
  background: $color-surface-muted;
}

.groupTab {
  display: inline-flex;
  gap: $spacing-xs;
  align-items: center;
  padding: $spacing-xs $spacing-md;
  border-radius: $radius-pill;
  color: $color-text-secondary;
  font-size: $font-size-base;
  transition:
    background-color $duration-fast $ease-out,
    color $duration-fast $ease-out,
    box-shadow $duration-fast $ease-out;

  &:hover {
    color: $color-primary;
  }
}

.groupTabActive {
  background: $color-surface;
  color: $color-primary;
  font-weight: 600;
  box-shadow: $shadow-xs;
}

.groupTabCount {
  min-width: 18px;
  padding: 0 5px;
  border-radius: $radius-pill;
  background: rgba($color-accent, 0.1);
  color: $color-accent;
  font-size: $font-size-xs;
  font-weight: 600;
  text-align: center;
}

.groupTabRefresh {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: $color-text-tertiary;
  transition:
    background-color $duration-fast $ease-out,
    color $duration-fast $ease-out;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover:not(:disabled) {
    background: $color-surface;
    color: $color-accent;
  }
}
</style>
