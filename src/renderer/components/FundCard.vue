<script setup lang="ts">
import { computed } from 'vue';
import type { FundGroup, FundItem } from '@/types/fund';
import {
  bondReferenceState,
  cardState,
  color,
  fundTypeClass,
  navReturnDate,
  navReturnLabel,
  navReturnSourceNote,
  navReturnValue,
  pct,
} from '@/lib/format';
import { estimateLabel, intervalNote, navPeriodLabel } from '@/lib/estimate';
import { calibrationInfo } from '@/lib/calibration';
import { useReadState } from '@/composables/useReadState';

/** 单只基金卡片。交互事件交给父组件，卡片本身只负责展示与读态。 */
const props = defineProps<{
  fund: FundItem;
  group: FundGroup;
  index: number;
  total: number;
  sortMode: string;
  query: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  select: [code: string, group: FundGroup];
  remove: [code: string];
  move: [code: string, group: FundGroup, step: number];
}>();

const readState = useReadState();

const actual = computed(() => props.fund.record?.actual ?? null);
const reference = computed(() => (props.fund.bond ? bondReferenceState(props.fund) : null));
const intraday = computed(
  () =>
    !!props.fund.bond &&
    !Number.isFinite(props.fund.navEstimate?.return) &&
    !actual.value &&
    Number.isFinite(reference.value?.return),
);
const value = computed(() => (intraday.value ? reference.value?.return : props.fund.navEstimate?.return));
const dot = computed(() => readState.unseen(props.fund, props.group));
const orderDisabled = computed(() => !!props.query || props.sortMode !== 'manual' || props.busy);

/** 历史校准参考：只在样本足够且模型匹配时出现。 */
const calibration = computed(() => calibrationInfo(props.fund, value.value));

const typeLabel = computed(() => {
  if (props.fund.bond) return '债券基金';
  if (props.fund.index || props.fund.indexQuote) return '指数基金';
  return '按持仓估算';
});

const estimateText = computed(() => {
  if (props.fund.refreshing) return '预估更新中';
  if (intraday.value) return reference.value?.label;
  if (reference.value && !actual.value && !Number.isFinite(props.fund.navEstimate?.return))
    return reference.value.label;
  return estimateLabel(props.fund);
});

const dateSuffix = computed(() =>
  props.fund.navEstimate?.mode === 'cumulative'
    ? ' · ' + navPeriodLabel(props.fund.navEstimate, props.fund.date) + '合计'
    : '',
);

const latestNavNote = computed(() =>
  props.fund.latestNav?.date && props.fund.latestNav.date !== props.fund.date
    ? '最近公布 ' + props.fund.latestNav.date + ' · ' + pct(navReturnValue(props.fund.latestNav))
    : '',
);

const stateTone = computed(() => {
  if (props.fund.error || props.fund.stale) return 'error';
  if (props.fund.record?.actual) return 'done';
  if (Number.isFinite(props.fund.navEstimate?.return)) return 'ready';
  return 'idle';
});

function onHover(): void {
  if (!dot.value) return;
  readState.markSeen(props.fund, props.group);
}
</script>

<template>
  <article
    class="fundCard"
    :class="fundTypeClass(fund)"
    :data-fund-code="fund.code"
    @mouseenter="onHover"
    @focusin="onHover"
  >
    <span v-if="dot" class="fundCardDot" title="上次查看后有新的公布涨跌结果" aria-label="有新公布结果" />

    <header class="fundCardHead">
      <button type="button" class="fundCardName" @click="emit('select', fund.code, group)">
        <span class="fundCardTitle">{{ fund.name }}</span>
        <span class="fundCardMeta">
          <code class="fundCardCode">{{ fund.code }}</code>
          <span class="fundCardType">{{ typeLabel }}</span>
        </span>
      </button>
      <div class="fundCardActions">
        <button
          type="button"
          class="fundCardAction"
          :aria-label="'上移 ' + fund.name"
          :disabled="orderDisabled || index === 0"
          @click="emit('move', fund.code, group, -1)"
        >
          ↑
        </button>
        <button
          type="button"
          class="fundCardAction"
          :aria-label="'下移 ' + fund.name"
          :disabled="orderDisabled || index === total - 1"
          @click="emit('move', fund.code, group, 1)"
        >
          ↓
        </button>
        <button type="button" class="fundCardAction fundCardActionRemove" @click="emit('remove', fund.code)">
          移除
        </button>
      </div>
    </header>

    <div class="fundCardValues">
      <div class="fundCardValue">
        <small class="fundCardValueLabel">{{ estimateText }}</small>
        <span class="fundCardValueMain">
          <strong :class="color(value)">{{ pct(value) }}</strong>
          <sup v-if="calibration" class="fundCardCalibration" :title="calibration.title">
            校准 {{ pct(calibration.corrected) }}
          </sup>
        </span>
      </div>
      <div class="fundCardValue">
        <small class="fundCardValueLabel"
          >{{ navReturnLabel(actual) }} · {{ navReturnDate(actual, fund.date ?? '—') }}</small
        >
        <strong :class="color(navReturnValue(actual))">{{ pct(navReturnValue(actual)) }}</strong>
        <small v-if="actual?.returnSource" class="fundCardValueNote">{{ navReturnSourceNote(actual) }}</small>
      </div>
    </div>

    <footer class="fundCardFoot">
      <span class="fundCardDate">目标净值日 · {{ fund.date ?? '—' }}{{ dateSuffix }}</span>
      <span class="fundCardState" :class="'fundCardState-' + stateTone">{{ cardState(fund) }}</span>
    </footer>

    <p v-if="latestNavNote" class="fundCardNote">{{ latestNavNote }}</p>
    <p v-if="intervalNote(fund)" class="fundCardBasis">{{ intervalNote(fund) }}</p>
    <p v-if="fund.pendingPublications?.length" class="fundCardPending">
      待公布 {{ fund.pendingPublications.length }} 期{{ fund.pendingPublications.length > 1 ? ' · 详情查看' : '' }}
    </p>
  </article>
</template>

<style lang="scss" scoped>
.fundCard {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
  padding: $spacing-lg;
  border: 1px solid $color-border;
  border-left: 3px solid $color-border;
  border-radius: $radius-lg;
  background: $color-surface;
  box-shadow: $shadow-sm;
  transition:
    box-shadow $duration-base $ease-out,
    transform $duration-base $ease-out,
    border-color $duration-base $ease-out;

  &:hover {
    transform: translateY(-1px);
    border-color: $color-border-strong;
    box-shadow: $shadow-md;
  }

  &:focus-within {
    border-color: $color-accent;
  }
}

.stockcard {
  border-left-color: $color-stock;
}

.indexcard {
  border-left-color: $color-index;
}

.bondcard {
  border-left-color: $color-bond;
}

.fundCardHead {
  display: flex;
  gap: $spacing-sm;
  justify-content: space-between;
  align-items: flex-start;
}

.fundCardName {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 0;
  text-align: left;
}

.fundCardTitle {
  overflow: hidden;
  color: $color-text;
  font-size: $font-size-md;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fundCardName:hover .fundCardTitle {
  color: $color-accent;
}

.fundCardMeta {
  display: flex;
  gap: $spacing-sm;
  align-items: center;
}

.fundCardCode {
  color: $color-text-tertiary;
  font-family: $font-family-mono;
  font-size: $font-size-xs;
}

.fundCardType {
  padding: 0 $spacing-sm;
  border-radius: $radius-pill;
  background: $color-surface-muted;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.fundCardActions {
  display: flex;
  gap: 2px;
  flex: none;
  opacity: 0;
  transition: opacity $duration-fast $ease-out;
}

.fundCard:hover .fundCardActions,
.fundCard:focus-within .fundCardActions {
  opacity: 1;
}

.fundCardAction {
  padding: 2px $spacing-sm;
  border: 1px solid transparent;
  border-radius: $radius-xs;
  color: $color-text-tertiary;
  font-size: $font-size-xs;

  &:hover:not(:disabled) {
    border-color: $color-border;
    background: $color-surface-muted;
    color: $color-primary;
  }
}

.fundCardActionRemove:hover:not(:disabled) {
  color: $color-up;
}

.fundCardValues {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $spacing-md;
  padding: $spacing-md 0;
  border-top: 1px dashed $color-border;
  border-bottom: 1px dashed $color-border;
}

.fundCardValue {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.fundCardValueLabel {
  overflow: hidden;
  color: $color-text-tertiary;
  font-size: $font-size-xs;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fundCardValueMain {
  display: flex;
  gap: $spacing-xs;
  align-items: baseline;
}

.fundCardValue strong {
  font-size: $font-size-xl;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.fundCardValueNote {
  color: $color-text-tertiary;
  font-size: $font-size-xs;
}

.fundCardCalibration {
  color: $color-text-tertiary;
  font-size: $font-size-xs;
  font-weight: 400;
}

.fundCardFoot {
  display: flex;
  gap: $spacing-sm;
  align-items: center;
  justify-content: space-between;
}

.fundCardDate {
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.fundCardState {
  padding: 1px $spacing-sm;
  border-radius: $radius-pill;
  background: $color-surface-muted;
  color: $color-text-secondary;
  font-size: $font-size-xs;
  text-align: right;
}

.fundCardState-done {
  background: $color-down-soft;
  color: $color-down;
}

.fundCardState-ready {
  background: $color-info-soft;
  color: $color-info;
}

.fundCardState-error {
  background: $color-warning-soft;
  color: $color-warning;
}

.fundCardNote {
  margin: 0;
  color: $color-text-tertiary;
  font-size: $font-size-xs;
}

.fundCardBasis {
  margin: 0;
  color: $color-text-tertiary;
  font-size: $font-size-xs;
}

.fundCardPending {
  margin: 0;
  color: $color-warning;
  font-size: $font-size-xs;
}

.fundCardDot {
  position: absolute;
  top: $spacing-md;
  right: $spacing-md;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: $color-up;
  box-shadow: 0 0 0 3px rgba($color-up, 0.12);
}

.up {
  color: $color-up;
}

.down {
  color: $color-down;
}
</style>
