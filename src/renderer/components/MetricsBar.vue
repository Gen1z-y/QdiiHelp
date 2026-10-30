<script setup lang="ts">
import { computed } from 'vue';
import type { FxSummary } from '@/types/fund';
import { color, num, pct } from '@/lib/format';

/** 指标条：基金数、已公布/已有预估数量，以及汇率参考块。 */
const props = defineProps<{
  metrics: { total: number; predicted: number; published: number; publishedHeld: number; publishedWatch: number };
  fx: FxSummary | null;
  fxUpdating: boolean;
}>();

const fxLabel = computed(() => (props.fx?.date ? props.fx.date + ' · 美元/人民币' : '美元/人民币'));

const fxNote = computed(() => {
  const data = props.fx;
  if (!data || data.error) return data?.error ?? '';
  return (
    '1 美元 = ' +
    num(data.close, 4) +
    ' 元 · 仅作参考' +
    (data.carried ? ' · 沿用' : '') +
    (props.fxUpdating ? ' · 更新中' : '')
  );
});

const fxTitle = computed(() => {
  const data = props.fx;
  if (!data) return '';
  return (data.source ?? '参考汇率') + ' · ' + (data.closeDate ?? '') + '；汇率涨跌不等于基金涨跌';
});
</script>

<template>
  <section class="metrics">
    <div class="metricsItem">
      <small class="metricsLabel">自选基金</small>
      <strong class="metricsValue">{{ metrics.total }}</strong>
    </div>
    <div class="metricsItem">
      <small class="metricsLabel">已有正式结果</small>
      <strong class="metricsValue">
        {{ metrics.published }}
        <span class="metricsSplit">持有 {{ metrics.publishedHeld }} · 自选 {{ metrics.publishedWatch }}</span>
      </strong>
    </div>
    <div class="metricsItem">
      <small class="metricsLabel">已有预估</small>
      <strong class="metricsValue">{{ metrics.predicted }}</strong>
    </div>
    <div v-if="fx || fxUpdating" class="metricsItem metricsItemFx">
      <small class="metricsLabel">{{ fxLabel }}</small>
      <strong class="metricsValue" :class="fx?.error ? '' : color(fx?.dailyReturn)">
        {{ fx?.error ? '暂不可用' : fx ? pct(fx.dailyReturn) : '更新中…' }}
      </strong>
      <small class="metricsNote" :title="fxTitle">{{ fx?.error ? fx.error : fxNote }}</small>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.metrics {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-md;
  padding: $spacing-md $spacing-xl;
  border-bottom: 1px solid $color-border;
  background: $color-surface;
}

.metricsItem {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 132px;
  padding: $spacing-sm $spacing-md;
  border: 1px solid $color-border;
  border-radius: $radius-md;
  background: $color-surface-muted;
}

.metricsItemFx {
  flex: 1.4;
}

.metricsLabel {
  color: $color-text-tertiary;
  font-size: $font-size-xs;
  letter-spacing: 0.3px;
}

.metricsValue {
  display: flex;
  gap: $spacing-sm;
  align-items: baseline;
  color: $color-text;
  font-size: $font-size-xl;
  font-weight: 600;
  line-height: 1.2;
}

.metricsSplit {
  color: $color-text-tertiary;
  font-size: $font-size-xs;
  font-weight: 400;
}

.metricsNote {
  color: $color-text-tertiary;
  font-size: $font-size-xs;
}
</style>
