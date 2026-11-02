<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { DetailTab } from '@/types/fund';
import { useDetail } from '@/composables/useDetail';
import { useReadState } from '@/composables/useReadState';
import {
  bondReferenceState,
  color,
  navReturnDate,
  navReturnLabel,
  navReturnSourceNote,
  navReturnValue,
  num,
  pct,
} from '@/lib/format';
import {
  estimateLabel,
  forecastInputs,
  fundFxImpact,
  indexContributionRows,
  navPeriodLabel,
  observationPanel,
  quoteStatusBadge,
} from '@/lib/estimate';
import { calibrationInfo } from '@/lib/calibration';
import DetailChart from './DetailChart.vue';
import DetailContribution from './DetailContribution.vue';
import DetailAccuracy from './DetailAccuracy.vue';
import BondFitPanel from './BondFitPanel.vue';

/**
 * 基金详情弹窗：概览 / 涨跌历史 / 持仓贡献 / 准确性（债基换成拟合与持仓）。
 * 概览用模板渲染；图表与贡献表复用 src/shared 的 HTML 输出（v-html），
 * 其中的区间、口径与分页按钮通过内容区事件委托处理。
 */

const {
  selectedCode,
  tab,
  tabs,
  contributionMode,
  quoteFilter,
  chartDays,
  chartMode,
  contributionPage,
  history,
  historyLoading,
  historyError,
  fund,
  detailFund,
  close,
  selectTab,
} = useDetail();
const readState = useReadState();

const dialogRef = ref<HTMLDialogElement | null>(null);

watch(selectedCode, (code) => {
  const dialog = dialogRef.value;
  if (!dialog) return;
  if (code && !dialog.open) dialog.showModal();
  else if (!code && dialog.open) dialog.close();
});

const current = detailFund;
const isIndex = computed(() => !!current.value?.indexQuote);
const isBond = computed(() => !!current.value?.bond);

const actual = computed(() => current.value?.record?.actual ?? null);
const estimate = computed(() => current.value?.navEstimate ?? null);

/** 债基盘中参考值（目标日国内收盘且三个指数齐全才有效）。 */
const bondState = computed(() => (current.value && isBond.value ? bondReferenceState(current.value) : null));
const intraday = computed(
  () =>
    !!bondState.value &&
    !Number.isFinite(estimate.value?.return) &&
    !actual.value &&
    Number.isFinite(bondState.value.return),
);

const shownReturn = computed(() => {
  if (Number.isFinite(estimate.value?.return)) return estimate.value?.return ?? null;
  return intraday.value ? (bondState.value?.return ?? null) : null;
});

const statusText = computed(() => {
  const item = current.value;
  if (!item) return '';
  if (actual.value) return '已公布，可核对';
  if (Number.isFinite(estimate.value?.return)) return item.record?.sealedAt ? '已封存 · 等公布' : '收盘后预估';
  return bondState.value?.message ?? '';
});

const periodLabel = computed(() => navPeriodLabel(estimate.value, current.value?.date ?? ''));

const calibration = computed(() =>
  current.value ? calibrationInfo(current.value, shownReturn.value, history.value ?? undefined) : null,
);

const coverage = computed(() => (current.value ? forecastInputs(current.value)?.model?.coverage : undefined));
const fxImpact = computed(() => (current.value ? fundFxImpact(current.value)?.contribution : undefined));

const officialValue = computed(() => navReturnValue(actual.value));
const latestNavValue = computed(() => navReturnValue(current.value?.latestNav));

const observationHtml = computed(() => (current.value ? observationPanel(current.value) : ''));

const contributionRows = computed(() => {
  const item = current.value;
  if (!item) return [];
  if (isIndex.value) return indexContributionRows(forecastInputs(item));
  const inputs = forecastInputs(item);
  return inputs?.rows ?? item.latestHoldings?.rows ?? [];
});

const contributionHoldings = computed(() => {
  const item = current.value;
  if (!item) return '';
  if (isIndex.value) return '假设全部跟踪该指数';
  return forecastInputs(item)?.holdingsDate ?? item.latestHoldings?.asOf ?? '';
});

const indexQuote = computed(() => current.value?.indexQuote ?? null);
const indexBadge = computed(() => (indexQuote.value ? quoteStatusBadge(indexQuote.value) : ''));

/** 内容区事件委托：shared 输出的按钮不带 Vue 事件，统一在这里解析 data-*。 */
function onContentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const quote = target.closest('[data-quote-filter]') as HTMLElement | null;
  if (quote?.dataset.quoteFilter) {
    quoteFilter.value = quote.dataset.quoteFilter;
    contributionPage.value = 1;
    return;
  }
  const range = target.closest('[data-detail-days]') as HTMLElement | null;
  if (range?.dataset.detailDays) {
    chartDays.value = Number(range.dataset.detailDays);
    return;
  }
  const mode = target.closest('[data-history-mode]') as HTMLElement | null;
  if (mode?.dataset.historyMode) {
    chartMode.value = mode.dataset.historyMode as 'periodic' | 'cumulative';
    return;
  }
  const contribution = target.closest('[data-contribution]') as HTMLElement | null;
  if (contribution?.dataset.contribution) {
    contributionMode.value = contribution.dataset.contribution as 'daily' | 'cumulative';
    contributionPage.value = 1;
    return;
  }
  const page = target.closest('[data-page-scope="contribution"]') as HTMLButtonElement | null;
  if (page && !page.disabled && page.dataset.page) {
    contributionPage.value = Number(page.dataset.page);
  }
}

/** 关闭时把当前卡片标记为已读，避免残留圆点。 */
function onClose(): void {
  const item = fund.value;
  if (item) readState.markSeen(item, item.group ?? 'watch');
  close();
}

function onTabClick(id: DetailTab): void {
  selectTab(id);
}
</script>

<template>
  <dialog ref="dialogRef" class="detailDialog" @close="onClose">
    <div v-if="current" class="detailBody" @click="onContentClick">
      <div class="dialogHead">
        <div>
          <h2 class="detailTitle">{{ current.name }}</h2>
          <small class="detailSub">{{ current.code }} · 净值日期 {{ current.date }}</small>
        </div>
        <button type="button" class="detailClose" @click="dialogRef?.close()">关闭</button>
      </div>

      <p v-if="current.navWarning" class="detailNote">{{ current.navWarning }}</p>

      <div class="detailTabs" role="tablist" aria-label="详情分区">
        <button
          v-for="item in tabs"
          :key="item.id"
          type="button"
          class="detailTabButton"
          :class="{ detailTabButtonActive: tab === item.id }"
          role="tab"
          :aria-selected="tab === item.id"
          @click="onTabClick(item.id)"
        >
          {{ item.label }}
        </button>
      </div>

      <section v-show="tab === 'overview'" class="detailPanel">
        <div class="detailsummary">
          <div class="tile">
            <small
              >{{ periodLabel }} · {{ isBond ? (intraday ? bondState?.label : '预估') : estimateLabel(current) }}</small
            >
            <strong :class="color(shownReturn)">{{ pct(shownReturn) }}</strong>
            <sup v-if="calibration" class="calTag" :title="calibration.title"
              >校准 {{ pct(calibration.corrected) }}</sup
            >
            <small v-if="isBond && statusText">{{ statusText }}</small>
          </div>

          <div v-if="!isBond && !isIndex" class="tile">
            <small>汇率影响（百分点）</small>
            <strong :class="color(fxImpact)">
              {{ Number.isFinite(fxImpact) ? (Number(fxImpact) > 0 ? '+' : '') + num(Number(fxImpact) * 100, 2) : '—' }}
            </strong>
          </div>

          <div v-if="isIndex && indexQuote" class="tile">
            <small>{{ indexQuote.name }}收盘涨跌</small>
            <strong :class="color(indexQuote.dailyReturn)">{{ pct(indexQuote.dailyReturn) }}</strong>
            <small>{{ indexQuote.date ?? '暂无数据' }} · 美元</small>
          </div>

          <div class="tile">
            <small>{{ navReturnLabel(actual) }} · {{ navReturnDate(actual, current.date) }}</small>
            <strong :class="color(officialValue)">{{ pct(officialValue) }}</strong>
            <small v-if="actual?.returnSource">{{ navReturnSourceNote(actual) }}</small>
            <small v-else-if="actual && !Number.isFinite(actual.dailyReturn)">
              单位净值 {{ num(actual.value, 4) }} · 涨跌幅待补全
            </small>
          </div>

          <div class="tile">
            <small>最新公布 · {{ current.latestNav?.date ?? '—' }}</small>
            <strong :class="color(latestNavValue)">{{ pct(latestNavValue) }}</strong>
          </div>

          <div v-if="!isBond && !isIndex" class="tile">
            <small>已用于估算的资产占比</small>
            <strong>{{ num(coverage, 2) }}%</strong>
          </div>
        </div>

        <div v-if="isIndex && indexQuote" class="indexNote">
          <p>
            根据这段时间的指数涨跌和汇率变化，估算人民币收益，也包括假期。假设基金全部跟踪该指数。实际持仓、费用等会造成差别，以正式净值为准。{{
              current.modelError ?? ''
            }}
          </p>
          <details class="indexDetails">
            <summary>查看指数数据和计算方法</summary>
            <p class="indexDetailsText">
              {{ indexQuote.source ?? '' }} · <span v-html="indexBadge" />
              <template v-if="indexQuote.date !== current.date">
                ；指数实际收盘日 {{ indexQuote.date }}，目标日股价沿用，汇率独立计算
              </template>
              <br />
              收盘涨跌 =（{{ num(indexQuote.close, 2) }} ÷ {{ num(indexQuote.previousClose, 2) }} − 1）×
              100%，前一交易日：{{ indexQuote.previousDate ?? '—' }}。未收盘时展示最近已完成交易日，并保留原日期。
            </p>
          </details>
        </div>

        <div v-html="observationHtml" />
      </section>

      <section v-show="tab === 'chart'" class="detailPanel">
        <DetailChart
          :fund="current"
          :pairs="history?.stats?.pairs ?? current.stats?.pairs ?? []"
          :days="chartDays"
          :mode="chartMode"
          :rows="history?.rows ?? []"
          :loading="historyLoading"
          :error="historyError"
        />
      </section>

      <section v-show="tab === 'contrib'" class="detailPanel">
        <DetailContribution
          :rows="contributionRows"
          :mode="contributionMode"
          :holdings-date="contributionHoldings"
          :page="contributionPage"
          :filter="quoteFilter"
        />
      </section>

      <section v-show="tab === 'fit'" class="detailPanel">
        <BondFitPanel :fund="current" />
      </section>

      <section v-show="tab === 'accuracy'" class="detailPanel">
        <DetailAccuracy :fund="current" />
      </section>
    </div>
  </dialog>
</template>

<style lang="scss" scoped>
.detailDialog {
  width: min(1100px, 92vw);
  max-height: 88vh;
  padding: 0;
  border: 1px solid $color-border;
  border-radius: $radius-lg;
  background: $color-surface;
  color: $color-text;
  overflow: hidden;
}

.detailDialog::backdrop {
  background: rgba(23, 54, 94, 0.36);
}

.detailBody {
  display: flex;
  flex-direction: column;
  gap: $spacing-md;
  max-height: 88vh;
  padding: $spacing-lg;
  overflow-y: auto;
}

.dialogHead {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.detailTitle {
  margin: 0;
  color: $color-primary;
  font-size: $font-size-title;
}

.detailSub {
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.detailClose {
  padding: $spacing-sm $spacing-lg;
  border: 1px solid $color-border-strong;
  border-radius: $radius-sm;
  background: $color-surface;
  color: $color-primary;
  font-size: $font-size-sm;
}

.detailNote {
  margin: 0;
  padding: $spacing-sm $spacing-md;
  border-left: 3px solid $color-warning;
  background: $color-warning-soft;
  color: $color-warning;
  font-size: $font-size-xs;
}

.detailTabs {
  display: flex;
  gap: $spacing-sm;
  padding-bottom: $spacing-sm;
  border-bottom: 1px solid $color-border;
}

.detailTabButton {
  padding: $spacing-xs $spacing-md;
  border: 1px solid transparent;
  border-radius: $radius-sm;
  background: transparent;
  color: $color-text-secondary;
  font-size: $font-size-sm;
}

.detailTabButtonActive {
  border-color: $color-primary;
  background: $color-primary-soft;
  color: $color-primary;
  font-weight: 600;
}

.detailPanel {
  display: block;
}

.detailsummary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: $spacing-md;
  margin-bottom: $spacing-md;
}

.detailsummary :deep(.tile) {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;
  padding: $spacing-md;
  border: 1px solid $color-border;
  border-radius: $radius-md;
  background: $color-surface;
}

.detailsummary :deep(.tile small) {
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.detailsummary :deep(.tile strong) {
  font-size: 22px;
}

.detailsummary :deep(.calTag) {
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.indexNote p {
  margin: 0 0 $spacing-sm;
  font-size: $font-size-sm;
}

.indexDetailsText {
  margin: 0;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}
</style>
