<script setup lang="ts">
import type { FundGroup, FundItem } from '@/types/fund';
import { sameWatchPriority } from '@shared/fund-order.ts';
import FundCard from './FundCard.vue';

/** 单个分组的卡片网格；空态区分“无基金”和“搜索无结果”。 */
defineProps<{
  group: FundGroup;
  list: FundItem[];
  query: string;
  sortMode: string;
  busy: boolean;
  emptyText: string;
}>();

const emit = defineEmits<{
  select: [code: string, group: FundGroup];
  remove: [code: string];
  move: [code: string, group: FundGroup, step: number];
}>();
</script>

<template>
  <div class="fundGrid">
    <FundCard
      v-for="(fund, index) in list"
      :key="fund.code"
      :fund="fund"
      :group="group"
      :index="index"
      :total="list.length"
      :sort-mode="sortMode"
      :query="query"
      :busy="busy"
      :blocked-up="group === 'watch' && index > 0 && !sameWatchPriority(list[index - 1], fund)"
      :blocked-down="group === 'watch' && index < list.length - 1 && !sameWatchPriority(list[index + 1], fund)"
      @select="(code, from) => emit('select', code, from)"
      @remove="(code) => emit('remove', code)"
      @move="(code, from, step) => emit('move', code, from, step)"
    />

    <div v-if="!list.length" class="fundGridEmpty">
      <svg
        class="fundGridEmptyIcon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        aria-hidden="true"
      >
        <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
        <path d="M3.5 9.5h17" stroke-linecap="round" />
        <path d="M8 13.5h8" stroke-linecap="round" />
      </svg>
      <p class="fundGridEmptyTitle">{{ query ? '没有符合筛选条件的' + emptyText : '还没有' + emptyText }}</p>
      <p class="fundGridEmptyHint">
        {{ query ? '换个关键词，或清空搜索框看看全部。' : '在顶部输入 6 位基金代码即可添加。' }}
      </p>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.fundGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: $spacing-lg;
}

.fundGridEmpty {
  display: flex;
  grid-column: 1 / -1;
  flex-direction: column;
  gap: $spacing-xs;
  align-items: center;
  padding: $spacing-xxl $spacing-lg;
  border: 1px dashed $color-border-strong;
  border-radius: $radius-lg;
  background: $color-surface-muted;
  text-align: center;
}

.fundGridEmptyIcon {
  width: 34px;
  height: 34px;
  margin-bottom: $spacing-sm;
  color: $color-border-strong;
}

.fundGridEmptyTitle {
  color: $color-text-secondary;
  font-size: $font-size-md;
}

.fundGridEmptyHint {
  color: $color-text-tertiary;
  font-size: $font-size-sm;
}
</style>
