<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import AppHeader from './components/AppHeader.vue';
import ToolbarBar from './components/ToolbarBar.vue';
import ProgressBar from './components/ProgressBar.vue';
import MetricsBar from './components/MetricsBar.vue';
import GroupTabs from './components/GroupTabs.vue';
import FundGrid from './components/FundGrid.vue';
import DetailDialog from './components/detail/DetailDialog.vue';
import HoldingsDialog from './components/holdings/HoldingsDialog.vue';
import CompareDialog from './components/compare/CompareDialog.vue';
import MarketsDialog from './components/markets/MarketsDialog.vue';
import ExportPreviewDialog from './components/ExportPreviewDialog.vue';
import RefreshReport from './components/RefreshReport.vue';
import SelectField from './components/ui/SelectField.vue';
import type { SelectOption } from './components/ui/SelectField.vue';
import { useFunds } from './composables/useFunds';
import { useDetail } from './composables/useDetail';
import { useHoldings } from './composables/useHoldings';
import { useCompare } from './composables/useCompare';
import { useMarkets } from './composables/useMarkets';
import { useExport } from './composables/useExport';
import { useReadState } from './composables/useReadState';
import { compareFunds } from './lib/format';
import { sortByWatchPriority } from '@shared/fund-order.ts';
import type { FundGroup, FundItem, SortMode } from './types/fund';

/**
 * 首页：工具栏 + 指标条 + 分组卡片列表。
 * 详情、对比、持仓、导出等入口按迁移顺序继续接入，先在工具栏保留占位。
 */

const funds = useFunds();
const readState = useReadState();
const detail = useDetail();
const holdings = useHoldings();
const compare = useCompare();
const markets = useMarkets();
const exporter = useExport();

const sortOptions: SelectOption[] = [
  { value: 'manual', label: '手动排序' },
  { value: 'estimate', label: '按预估排序' },
  { value: 'coverage', label: '按覆盖率排序' },
  { value: 'pending', label: '待公布优先' },
];

/** 打开详情：先把卡片标记为已读，再按基金代码加载历史净值。 */
function onSelect(code: string, group: FundGroup): void {
  const item = funds.items.value.find((fund) => fund.code === code);
  if (item) readState.markSeen(item, group);
  detail.open(code);
}

const groups: { key: FundGroup; label: string; empty: string }[] = [
  { key: 'held', label: '持有', empty: '持有基金' },
  { key: 'watch', label: '自选', empty: '自选基金' },
  { key: 'bond', label: '债基', empty: '债基' },
];

/** tab 上的数量按分组统计，不受搜索影响（与旧页面一致）。 */
const groupCounts = computed(() => {
  const counts = { held: 0, watch: 0, bond: 0 } as Record<FundGroup, number>;
  for (const fund of funds.items.value) {
    for (const group of ['held', 'watch', 'bond'] as FundGroup[]) {
      if (group === 'bond' ? !!fund.bond : (fund.group ?? 'watch') === group) counts[group] += 1;
    }
  }
  return counts;
});

/** 当前分组经过搜索与排序后的列表；手动排序时自选组把名称优先的基金排在前面。 */
function visibleFunds(group: FundGroup): FundItem[] {
  const list = funds.groupedFunds.value[group] ?? [];
  if (funds.sortMode.value === 'manual') return group === 'watch' ? sortByWatchPriority(list) : list;
  return [...list].sort((a, b) => compareFunds(funds.sortMode.value, a, b));
}

const searchHint = computed(() => {
  const query = funds.query.value.trim().toLowerCase();
  if (!query) return '';
  const matches = funds.items.value.filter(
    (fund) => fund.code.includes(query) || fund.name.toLowerCase().includes(query),
  );
  return (
    `找到 ${matches.length} 只基金：持有 ${matches.filter((fund) => fund.group === 'held').length} 只，` +
    `自选 ${matches.filter((fund) => (fund.group ?? 'watch') === 'watch').length} 只。切换分组查看对应卡片。`
  );
});

async function onAdd(code: string, group: 'held' | 'watch'): Promise<void> {
  try {
    await funds.add(code, group);
  } catch (error) {
    funds.notice.value = error instanceof Error ? error.message : String(error);
  }
}

async function onRemove(code: string): Promise<void> {
  try {
    await funds.remove(code);
  } catch (error) {
    funds.notice.value = error instanceof Error ? error.message : String(error);
  }
}

async function onMove(code: string, group: FundGroup, step: number): Promise<void> {
  try {
    await funds.move(code, group, step);
  } catch (error) {
    funds.notice.value = error instanceof Error ? error.message : String(error);
  }
}

// 与旧页面一致：每次列表变化先补齐读态基准，避免升级后一次性刷出圆点。
watch(funds.items, (list) => readState.initialize(list), { immediate: true });

onMounted(() => {
  void funds.loadSaved();
});
</script>

<template>
  <div class="appShell">
    <AppHeader />

    <ToolbarBar
      :busy="funds.busy.value"
      :status="funds.status.value"
      :history-text="funds.historyText.value"
      :existing-codes="funds.items.value.map((fund) => fund.code)"
      @refresh="funds.refresh()"
      @holdings="holdings.open()"
      @markets="markets.open()"
      @export="exporter.run(funds.items.value)"
      @add="onAdd"
    />

    <ProgressBar :progress="funds.progress.value" />
    <RefreshReport />

    <div v-if="funds.notice.value" class="noticeBar" role="alert">
      <span class="noticeBarIcon" aria-hidden="true">!</span>
      {{ funds.notice.value }}
    </div>
    <div v-if="exporter.error.value" class="noticeBar" role="alert">
      <span class="noticeBarIcon" aria-hidden="true">!</span>
      {{ exporter.error.value }}
    </div>

    <MetricsBar :metrics="funds.metrics.value" :fx="funds.fx.value" :fx-updating="funds.fxUpdating.value" />

    <main class="content">
      <div class="sectionHead">
        <div class="fundTitleGroup">
          <h2 class="sectionTitle">我的基金</h2>
          <GroupTabs
            :active="funds.activeGroup.value"
            :counts="groupCounts"
            :busy="funds.busy.value"
            @select="(group) => (funds.activeGroup.value = group)"
            @refresh="(group) => funds.refresh({ group })"
          />
        </div>
        <div class="fundTools">
          <div class="fundSearchWrap">
            <svg
              class="fundSearchIcon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="6" />
              <path d="m20 20-3.5-3.5" stroke-linecap="round" />
            </svg>
            <input
              v-model="funds.query.value"
              class="fundSearch"
              type="search"
              placeholder="搜索基金名称 / 代码"
              aria-label="搜索持有和自选基金"
              autocomplete="off"
            />
          </div>
          <SelectField
            :model-value="funds.sortMode.value"
            :options="sortOptions"
            aria-label="排序方式"
            width="132px"
            @update:model-value="(value) => funds.setSort(value as SortMode)"
          />
          <button type="button" class="toolbarPlain" @click="compare.open()">基金对比</button>
        </div>
      </div>

      <p v-if="searchHint" class="searchHint">{{ searchHint }}</p>

      <section
        v-for="group in groups"
        v-show="funds.activeGroup.value === group.key"
        :key="group.key"
        class="fundGroup"
        role="tabpanel"
      >
        <FundGrid
          :group="group.key"
          :list="visibleFunds(group.key)"
          :query="funds.query.value"
          :sort-mode="funds.sortMode.value"
          :busy="funds.busy.value"
          :empty-text="group.empty"
          @select="onSelect"
          @remove="onRemove"
          @move="onMove"
        />
      </section>
    </main>

    <DetailDialog />
    <HoldingsDialog />
    <CompareDialog />
    <MarketsDialog />
    <ExportPreviewDialog />

    <footer class="appFooter">
      <p>
        数据：天天基金披露净值与持仓、东方财富行情及人民币中间价；备用：腾讯、NAVER 与 Frankfurter
        参考汇率。持仓来自基金公司最近公布资料，有一定延迟。
      </p>
      <p>
        预估仅供参考，以基金公司公布为准。只计算有数据的持仓，未单独扣除费用；持仓资料超过 190
        天时暂停预估。点击“刷新数据”获取最新结果，不会自动刷新。
      </p>
    </footer>
  </div>
</template>

<style lang="scss" scoped>
.appShell {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  background: $color-bg;
}

.noticeBar {
  display: flex;
  gap: $spacing-sm;
  align-items: center;
  padding: $spacing-sm $spacing-xl;
  border-bottom: 1px solid rgba($color-warning, 0.24);
  background: $color-warning-soft;
  color: $color-warning;
  font-size: $font-size-sm;
}

.noticeBarIcon {
  display: grid;
  place-items: center;
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: $color-warning;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.content {
  flex: 1;
  padding: $spacing-xl;
}

.sectionHead {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-lg;
  align-items: center;
  justify-content: space-between;
  margin-bottom: $spacing-lg;
}

.fundTitleGroup {
  display: flex;
  gap: $spacing-lg;
  align-items: center;
}

.sectionTitle {
  margin: 0;
  color: $color-primary;
  font-size: $font-size-lg;
  letter-spacing: 0.3px;
}

.fundTools {
  display: flex;
  gap: $spacing-sm;
  align-items: center;
}

.fundSearchWrap {
  position: relative;
  display: flex;
  align-items: center;
}

.fundSearchIcon {
  position: absolute;
  left: $spacing-sm;
  width: 14px;
  height: 14px;
  color: $color-text-tertiary;
  pointer-events: none;
}

.fundSearch {
  width: 220px;
  padding: $spacing-sm $spacing-md $spacing-sm 30px;
  border: 1px solid $color-border;
  border-radius: $radius-sm;
  background: $color-surface;
  font-size: $font-size-sm;
  transition:
    border-color $duration-fast $ease-out,
    box-shadow $duration-fast $ease-out;

  &:focus {
    border-color: $color-accent;
    box-shadow: $shadow-focus;
    outline: none;
  }
}

.toolbarPlain {
  padding: $spacing-sm $spacing-md;
  border: 1px solid $color-border;
  border-radius: $radius-sm;
  background: $color-surface;
  color: $color-primary;
  font-size: $font-size-sm;
  transition:
    background-color $duration-fast $ease-out,
    border-color $duration-fast $ease-out;

  &:hover {
    border-color: $color-border-strong;
    background: $color-surface-muted;
  }
}

.fundGroup {
  margin: 0 0 $spacing-xl;
}

.searchHint {
  margin: 0 0 $spacing-lg;
  padding: $spacing-sm $spacing-md;
  border-radius: $radius-sm;
  background: $color-primary-softer;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.appFooter {
  padding: $spacing-lg $spacing-xl;
  border-top: 1px solid $color-border;
  background: $color-surface;
  color: $color-text-tertiary;
  font-size: $font-size-xs;
  text-align: center;
}

.appFooter p {
  margin: 0 0 $spacing-xs;
}
</style>
