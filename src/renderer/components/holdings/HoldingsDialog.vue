<script setup lang="ts">
import { ref, watch } from 'vue';
import { useHoldings } from '@/composables/useHoldings';
import HoldingsChangesDialog from './HoldingsChangesDialog.vue';

/**
 * 基金持仓弹窗：同步全部持仓并重估、单只同步、结果表与分页。
 * 表格行与分页按钮由 src/shared/holdings-ui.ts 生成，这里通过事件委托处理。
 */

const {
  report,
  busy,
  progress,
  query,
  page,
  updatedOnly,
  opened,
  error,
  filtered,
  rowsHtml,
  paginationHtml,
  updatedFundsHtml,
  summaryText,
  resultCount,
  syncedAtText,
  syncAll,
  syncOne,
  close,
  openChanges,
  markRow,
} = useHoldings();

const dialogRef = ref<HTMLDialogElement | null>(null);

watch(opened, (value) => {
  const dialog = dialogRef.value;
  if (!dialog) return;
  if (value && !dialog.open) dialog.showModal();
  else if (!value && dialog.open) dialog.close();
});

const progressText = () => {
  const state = progress.value;
  if (!state) return '';
  return (
    `${state.phase === 'recalculate' ? '正在重新估算' : '正在获取持仓'}：${state.completed} / ${state.total ?? '…'} 只` +
    (state.code ? ' · ' + state.code + ' ' + (state.name ?? '') : '') +
    (state.stage ? ' · ' + state.stage : '')
  );
};

/** 内容区事件委托：同步单只、查看变化、翻页、跳转筛选。 */
function onClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const one = target.closest('[data-sync-one]') as HTMLButtonElement | null;
  if (one?.dataset.syncOne) {
    void syncOne(one.dataset.syncOne);
    return;
  }
  const changes = target.closest('[data-holdings-changes]') as HTMLElement | null;
  if (changes?.dataset.holdingsChanges) {
    const row = report.value?.items.find((item) => item.code === changes.dataset.holdingsChanges);
    if (row) void openChanges(row);
    return;
  }
  const pageButton = target.closest('[data-page-scope="holdings"]') as HTMLButtonElement | null;
  if (pageButton && !pageButton.disabled && pageButton.dataset.page) {
    page.value = Number(pageButton.dataset.page);
    return;
  }
  const jump = target.closest('[data-holdings-jump]') as HTMLElement | null;
  if (jump?.dataset.holdingsJump) {
    query.value = jump.dataset.holdingsJump;
    page.value = 1;
    updatedOnly.value = false;
    return;
  }
  const scroll = target.closest('[data-holdings-scroll]') as HTMLElement | null;
  if (scroll) {
    const viewport = scroll.parentElement?.querySelector('.holdingsNameViewport');
    viewport?.scrollBy({
      left: Number(scroll.dataset.holdingsScroll ?? 1) * viewport.clientWidth * 0.8,
      behavior: 'smooth',
    });
  }
}

/** 行悬停或聚焦即视为已读。 */
function onRead(event: Event): void {
  const target = event.target as HTMLElement;
  const row = target.closest('[data-holdings-row]') as HTMLElement | null;
  if (row?.dataset.holdingsRow) markRow(row.dataset.holdingsRow);
}
</script>

<template>
  <dialog ref="dialogRef" class="holdingsDialog" @close="close">
    <div class="holdingsBody">
      <div class="dialogHead">
        <h2 class="holdingsTitle">基金持仓</h2>
        <div class="holdingsActions">
          <button type="button" class="holdingsPrimary" :disabled="busy" @click="syncAll">
            {{ busy ? '正在同步…' : '同步持仓并估算' }}
          </button>
          <button type="button" class="holdingsSecondary" @click="dialogRef?.close()">关闭</button>
        </div>
      </div>

      <p class="holdingsHint">持仓变化时重算未公布预估。</p>
      <p v-if="progress" class="holdingsProgress" role="status" aria-live="polite">{{ progressText() }}</p>
      <p v-if="error" class="holdingsError">{{ error }}</p>

      <div class="holdingsTools">
        <input
          v-model="query"
          class="holdingsSearch"
          type="search"
          placeholder="搜索基金名称 / 代码"
          aria-label="搜索同步结果基金"
          @input="page = 1"
        />
        <label class="holdingsToggle">
          <input v-model="updatedOnly" type="checkbox" @change="page = 1" />
          只看有更新
        </label>
      </div>

      <div class="holdingsResult" @click="onClick" @mouseover="onRead" @focusin="onRead">
        <p v-if="!report?.items?.length" class="holdingsMuted">尚未同步</p>
        <template v-else>
          <p class="holdingsSummary">
            <span>{{ summaryText }}</span>
            <time>{{ syncedAtText }}</time>
          </p>
          <div v-html="updatedFundsHtml" />
          <details class="holdingsResults" open>
            <summary>同步结果 · {{ resultCount }} 只{{ query ? `（匹配 ${filtered.length} 只）` : '' }}</summary>
            <div class="tablewrap">
              <table class="holdingsSyncTable">
                <thead>
                  <tr>
                    <th>基金</th>
                    <th>持仓截至日</th>
                    <th>持仓数</th>
                    <th>最新持仓构成</th>
                    <th>本次变化</th>
                  </tr>
                </thead>
                <tbody v-html="rowsHtml" />
              </table>
            </div>
            <div v-html="paginationHtml" />
            <p class="holdingsFootnote">占比为基金净资产比例；“其他”为图中未列部分。</p>
          </details>
        </template>
      </div>
    </div>

    <HoldingsChangesDialog />
  </dialog>
</template>

<style lang="scss" scoped>
.holdingsDialog {
  width: min(1040px, 94vw);
  max-height: 88vh;
  padding: 0;
  border: 1px solid $color-border;
  border-radius: $radius-lg;
  background: $color-surface;
  color: $color-text;
  overflow: hidden;
}

.holdingsDialog::backdrop {
  background: rgba(23, 54, 94, 0.36);
}

.holdingsBody {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
  max-height: 88vh;
  padding: $spacing-lg;
  overflow-y: auto;
}

.dialogHead {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.holdingsTitle {
  margin: 0;
  color: $color-primary;
  font-size: $font-size-title;
}

.holdingsActions {
  display: flex;
  gap: $spacing-sm;
}

.holdingsPrimary {
  padding: $spacing-sm $spacing-lg;
  border: 1px solid $color-primary;
  border-radius: $radius-sm;
  background: $color-primary;
  color: $color-text-inverse;
  font-size: $font-size-sm;
}

.holdingsSecondary {
  padding: $spacing-sm $spacing-lg;
  border: 1px solid $color-border-strong;
  border-radius: $radius-sm;
  background: $color-surface;
  color: $color-primary;
  font-size: $font-size-sm;
}

.holdingsHint,
.holdingsFootnote,
.holdingsMuted {
  margin: 0;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.holdingsProgress {
  margin: 0;
  color: $color-primary;
  font-size: $font-size-xs;
}

.holdingsError {
  margin: 0;
  padding: $spacing-sm $spacing-md;
  border-left: 3px solid $color-warning;
  background: $color-warning-soft;
  color: $color-warning;
  font-size: $font-size-xs;
}

.holdingsTools {
  display: flex;
  gap: $spacing-md;
  align-items: center;
}

.holdingsSearch {
  width: 240px;
  padding: $spacing-sm $spacing-md;
  border: 1px solid $color-border;
  border-radius: $radius-sm;
  font-size: $font-size-sm;
}

.holdingsToggle {
  display: flex;
  gap: $spacing-xs;
  align-items: center;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.holdingsResult {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}

.holdingsSummary {
  display: flex;
  gap: $spacing-md;
  justify-content: space-between;
  margin: 0;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.holdingsResults > summary {
  cursor: pointer;
  color: $color-primary;
  font-size: $font-size-sm;
}

.holdingsSyncTable {
  width: 100%;
  border-collapse: collapse;
  font-size: $font-size-xs;
}

.holdingsSyncTable :deep(th),
.holdingsSyncTable :deep(td) {
  padding: $spacing-xs $spacing-sm;
  border-bottom: 1px solid $color-border;
  text-align: left;
  vertical-align: top;
}

.holdingsSyncTable :deep(small) {
  display: block;
  color: $color-text-secondary;
}
</style>
