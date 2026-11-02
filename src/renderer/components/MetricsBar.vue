<script setup lang="ts">
import { computed } from 'vue';
import type { FxSummary } from '@/types/fund';
import { color, num, pct } from '@/lib/format';

/** 指标条：基金数、已公布/已有预估数量，以及官方中间价汇率块。 */
const props = defineProps<{
  metrics: { total: number; predicted: number; published: number; publishedHeld: number; publishedWatch: number };
  fx: FxSummary | null;
  fxUpdating: boolean;
}>();

/** 首页只认中国外汇交易中心的中间价，旧缓存里的第三方参考汇率不再展示。 */
const OFFICIAL_FX_URL = 'https://www.chinamoney.com.cn/chinese/bkccpr/';
const official = computed(() => {
  const data = props.fx;
  return !!data && !data.error && data.authority === 'CFETS' && data.sourceUrl === OFFICIAL_FX_URL;
});

const fxLabel = computed(() =>
  props.fx?.closeDate ? props.fx.closeDate + ' · 美元/人民币 · 官方中间价' : '美元/人民币 · 官方中间价',
);

const fxValue = computed(() => {
  const data = props.fx;
  if (data?.error) return '暂不可用';
  if (!official.value) return props.fxUpdating ? '更新中…' : '待获取';
  return pct(data?.dailyReturn);
});

const fxTone = computed(() => (official.value ? color(props.fx?.dailyReturn) : ''));

const fxNote = computed(() => {
  const data = props.fx;
  if (data?.error) return data.error;
  if (!data) return '点击“刷新数据”获取官方汇率';
  if (!official.value) return '请通过托盘重启后台，再刷新获取官方数据';
  return (
    '1 美元 = ' +
    num(data.close, 4) +
    ' 元' +
    (data.carried ? ' · 查询日 ' + (data.date ?? '') + '，沿用最近公布值' : '') +
    (props.fxUpdating ? ' · 更新中' : '') +
    (data.updateError ? ' · 更新失败，保留官方缓存' : '')
  );
});

const fxTitle = computed(() => {
  const data = props.fx;
  if (!data || !official.value) return '';
  return (data.source ?? '') + '；比较日期：' + (data.previousDate ?? '未知') + ' → ' + (data.closeDate ?? '未知');
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
    <div class="metricsItem metricsItemFx">
      <small class="metricsLabel">{{ fxLabel }}</small>
      <strong class="metricsValue" :class="fxTone">{{ fxValue }}</strong>
      <small class="metricsNote" :title="fxTitle">{{ fxNote }}</small>
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
