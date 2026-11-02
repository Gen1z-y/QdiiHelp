<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useCompare } from '@/composables/useCompare';
import { buildCompareSvg, compareSummary, compareTooltip, SERIES_COLORS } from '@/lib/compare-chart';
import { color, navReturnDate, navReturnValue, num, pct } from '@/lib/format';
import { forecastInputs, navPeriodLabel } from '@/lib/estimate';
import type { FundItem } from '@/types/fund';
import SelectField from '../ui/SelectField.vue';
import type { SelectOption } from '../ui/SelectField.vue';

/**
 * 基金对比弹窗：2–8 只基金的预估/公布指标、历史涨跌曲线与共同披露持仓。
 * 曲线由 lib/compare-chart.js 纯函数生成 SVG。
 */

const {
  comparing,
  query,
  days,
  mode,
  result,
  loading,
  status,
  opened,
  sliderIndex,
  pickable,
  selectedFunds,
  load,
  toggle,
  remove,
  setDays,
  setMode,
  close,
} = useCompare();

const dialogRef = ref<HTMLDialogElement | null>(null);

watch(opened, (value) => {
  const dialog = dialogRef.value;
  if (!value || !dialog) {
    if (!value && dialog?.open) dialog.close();
    return;
  }
  if (!dialog.open) dialog.showModal();
});

const modeOptions: SelectOption[] = [
  { value: 'cumulative', label: '累计涨跌幅' },
  { value: 'daily', label: '单日涨跌幅' },
];

const ranges: { days: number; label: string }[] = [
  { days: 30, label: '近1月' },
  { days: 90, label: '近3月' },
  { days: 180, label: '近6月' },
  { days: 365, label: '近1年' },
  { days: 1095, label: '近3年' },
  { days: 1825, label: '近5年' },
  { days: 0, label: '成立以来' },
];

const chartSvg = computed(() => (result.value ? buildCompareSvg(result.value, mode.value) : ''));
const summaryRows = computed(() => (result.value ? compareSummary(result.value) : []));
const tooltip = computed(() =>
  result.value ? compareTooltip(result.value, sliderIndex.value, mode.value) : { date: '', values: [] },
);

/** 逐项指标表：先看日期，再比涨跌。 */
const metrics = computed<{ label: string; read: (fund: FundItem) => string }[]>(() => [
  { label: '预估涨跌', read: (fund) => pct(fund.navEstimate?.return) },
  { label: '净值日期', read: (fund) => fund.date },
  { label: '预估日期范围', read: (fund) => navPeriodLabel(fund.navEstimate, fund.date) },
  { label: '基金公司公布涨跌', read: (fund) => pct(navReturnValue(fund.record?.actual)) },
  { label: '公布比较区间', read: (fund) => navReturnDate(fund.record?.actual, fund.date) },
  {
    label: '已用于估算的资产占比',
    read: (fund) => {
      if (fund.bond) return '不适用（指数拟合）';
      const coverage = forecastInputs(fund)?.model?.coverage;
      return Number.isFinite(coverage) ? num(coverage, 2) + '%' : '—';
    },
  },
  { label: '估算所用持仓日期', read: (fund) => forecastInputs(fund)?.holdingsDate ?? '—' },
  { label: '已对比次数', read: (fund) => String(fund.stats?.pairedCount ?? 0) },
  { label: '最近30次平均相差（百分点）', read: (fund) => num(fund.stats?.mae, 2) },
]);

/** 共同披露持仓：只列出至少两只基金都披露的标的。 */
const sharedHoldings = computed(() => {
  const funds = selectedFunds.value;
  const map = new Map<string, { name: string; code: string; weights: Record<string, number> }>();
  for (const fund of funds) {
    for (const row of fund.latestHoldings?.rows ?? []) {
      const key = row.secid ?? row.code;
      const entry = map.get(key) ?? { name: row.name, code: row.code, weights: {} };
      entry.weights[fund.code] = row.weight;
      map.set(key, entry);
    }
  }
  return [...map.values()].filter((entry) => Object.keys(entry.weights).length >= 2);
});

function onToggle(code: string): void {
  toggle(code);
}
</script>

<template>
  <dialog ref="dialogRef" class="compareDialog" @close="close">
    <div class="compareBody">
      <div class="dialogHead">
        <div>
          <h2 class="compareTitle">基金对比</h2>
          <small class="compareSub">请选择 2–8 只基金，在下方对比历史涨跌。</small>
        </div>
        <button type="button" class="compareClose" @click="dialogRef?.close()">关闭</button>
      </div>

      <div class="comparePickerHead">
        <input
          v-model="query"
          class="compareSearch"
          type="search"
          placeholder="搜索基金名称 / 代码"
          aria-label="搜索参与对比的基金"
          autocomplete="off"
        />
        <span class="compareStatus" role="status">
          找到 {{ pickable.length }} 只 · 已选 {{ comparing.length }} / 8 只
        </span>
      </div>

      <div class="comparePicker">
        <label v-for="fund in pickable" :key="fund.code" class="compareOption">
          <input type="checkbox" :checked="comparing.includes(fund.code)" @change="onToggle(fund.code)" />
          {{ fund.name }}
          <small>{{ fund.code }} · {{ fund.group === 'held' ? '持有' : '自选' }}</small>
        </label>
        <p v-if="!pickable.length" class="compareMuted">未找到匹配基金，请尝试名称或代码。</p>
      </div>

      <div v-if="selectedFunds.length" class="compareSelected">
        <button
          v-for="fund in selectedFunds"
          :key="fund.code"
          type="button"
          class="compareChip"
          @click="remove(fund.code)"
        >
          已选：{{ fund.name }} ×
        </button>
      </div>

      <p class="compareMuted">{{ status }}</p>

      <div class="compareControls">
        <div class="compareRanges" role="group" aria-label="历史时间范围">
          <button
            v-for="range in ranges"
            :key="range.days"
            type="button"
            class="compareRangeButton"
            :class="{ compareRangeButtonActive: days === range.days }"
            @click="setDays(range.days)"
          >
            {{ range.label }}
          </button>
        </div>
        <SelectField
          :model-value="mode"
          :options="modeOptions"
          aria-label="图表指标"
          width="126px"
          @update:model-value="(value) => setMode(value as 'cumulative' | 'daily')"
        />
        <button type="button" class="compareRefresh" :disabled="loading" @click="load(true)">更新历史数据</button>
      </div>

      <div v-if="result" class="compareChart">
        <div class="compareLegend">
          <span
            v-for="(series, index) in result.series"
            :key="series.code"
            :style="{ color: SERIES_COLORS[index % SERIES_COLORS.length] }"
          >
            {{ series.name }} ({{ series.code }})
          </span>
        </div>
        <div class="compareCanvas" v-html="chartSvg" />
        <label class="compareSlider">
          选择日期查看数值
          <input v-model.number="sliderIndex" type="range" min="0" :max="Math.max(0, result.dates.length - 1)" />
        </label>
        <p class="compareTooltip">
          <strong>{{ tooltip.date }}</strong>
          <span
            v-for="(point, index) in tooltip.values"
            :key="point.code"
            :style="{ color: SERIES_COLORS[index % SERIES_COLORS.length] }"
          >
            {{ point.code }} {{ pct(point.value) }}
          </span>
        </p>
        <div class="tablewrap">
          <table class="compareTable">
            <thead>
              <tr>
                <th>基金</th>
                <th>这段时间合计涨跌</th>
                <th>这段时间从高点最多跌了多少</th>
                <th>历史数据更新时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in summaryRows" :key="row.code">
                <td>{{ row.name }}</td>
                <td :class="color(row.totalReturn)">{{ pct(row.totalReturn) }}</td>
                <td :class="color(row.maxDrawdown)">{{ pct(row.maxDrawdown) }}</td>
                <td>
                  {{ row.fetchedAt ? new Date(row.fetchedAt).toLocaleString('zh-CN') : '—'
                  }}{{ row.stale ? '（缓存）' : '' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="selectedFunds.length >= 2" class="compareMetrics">
        <h3 class="compareSubtitle">预估与公布指标</h3>
        <div class="tablewrap">
          <table class="compareTable">
            <thead>
              <tr>
                <th>指标</th>
                <th v-for="fund in selectedFunds" :key="fund.code">{{ fund.name }}<br />{{ fund.code }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="metric in metrics" :key="metric.label">
                <td>{{ metric.label }}</td>
                <td v-for="fund in selectedFunds" :key="fund.code">{{ metric.read(fund) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 class="compareSubtitle">共同重仓股 · {{ sharedHoldings.length }} 只</h3>
        <p class="compareMuted">基于各基金最新披露的持仓，不代表全部资产重合程度。</p>
        <div class="tablewrap">
          <table class="compareTable">
            <thead>
              <tr>
                <th>股票</th>
                <th v-for="fund in selectedFunds" :key="fund.code">{{ fund.code }} 净资产占比</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sharedHoldings" :key="row.code">
                <td>{{ row.name }} ({{ row.code }})</td>
                <td v-for="fund in selectedFunds" :key="fund.code">
                  {{ row.weights[fund.code] === undefined ? '未在披露列表中' : num(row.weights[fund.code], 2) + '%' }}
                </td>
              </tr>
              <tr v-if="!sharedHoldings.length">
                <td :colspan="selectedFunds.length + 1">未发现共同披露持仓。</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p class="compareMuted">
        选择 2–8 只基金，对比同一段时间的实际表现。曲线从同一天的 0%
        开始，按基金公司公布的涨跌计算。这里不是预估准确率，结果可能与其他平台不同。
      </p>
    </div>
  </dialog>
</template>

<style lang="scss" scoped>
.compareDialog {
  width: min(1120px, 94vw);
  max-height: 90vh;
  padding: 0;
  border: 1px solid $color-border;
  border-radius: $radius-lg;
  background: $color-surface;
  color: $color-text;
  /* 不裁剪溢出内容：SelectField 的下拉面板挂在 dialog 上，需要可见 */
  overflow: visible;
}

.compareDialog::backdrop {
  background: rgba(23, 54, 94, 0.36);
}

.compareBody {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
  max-height: 90vh;
  padding: $spacing-lg;
  overflow-y: auto;
}

.dialogHead {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.compareTitle {
  margin: 0;
  color: $color-primary;
  font-size: $font-size-title;
}

.compareSub {
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.compareClose {
  padding: $spacing-sm $spacing-lg;
  border: 1px solid $color-border-strong;
  border-radius: $radius-sm;
  background: $color-surface;
  color: $color-primary;
  font-size: $font-size-sm;
}

.comparePickerHead {
  display: flex;
  gap: $spacing-md;
  align-items: center;
}

.compareSearch {
  width: 260px;
  padding: $spacing-sm $spacing-md;
  border: 1px solid $color-border;
  border-radius: $radius-sm;
  font-size: $font-size-sm;
}

.compareStatus {
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.comparePicker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: $spacing-xs $spacing-md;
  max-height: 140px;
  padding: $spacing-sm;
  overflow-y: auto;
  border: 1px solid $color-border;
  border-radius: $radius-sm;
}

.compareOption {
  display: flex;
  gap: $spacing-xs;
  align-items: center;
  color: $color-text;
  font-size: $font-size-sm;
}

.compareOption small {
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.compareSelected {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm;
}

.compareChip {
  padding: $spacing-xs $spacing-md;
  border: 1px solid $color-primary;
  border-radius: 999px;
  background: $color-primary-soft;
  color: $color-primary;
  font-size: $font-size-xs;
}

.compareMuted {
  margin: 0;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.compareControls {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm;
  align-items: center;
  margin-top: $spacing-sm;
}

.compareRanges {
  display: flex;
  gap: $spacing-xs;
}

.compareRangeButton {
  padding: $spacing-xs $spacing-sm;
  border: 1px solid $color-border;
  border-radius: $radius-sm;
  background: $color-surface;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.compareRangeButtonActive {
  border-color: $color-primary;
  background: $color-primary-soft;
  color: $color-primary;
  font-weight: 600;
}

.compareMode {
  padding: $spacing-xs $spacing-sm;
  border: 1px solid $color-border;
  border-radius: $radius-sm;
  font-size: $font-size-xs;
}

.compareRefresh {
  margin-left: auto;
  padding: $spacing-xs $spacing-md;
  border: 1px solid $color-primary;
  border-radius: $radius-sm;
  background: $color-primary;
  color: $color-text-inverse;
  font-size: $font-size-xs;
}

.compareChart {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}

.compareLegend {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-md;
  font-size: $font-size-xs;
}

.compareCanvas {
  overflow-x: auto;
}

.compareSlider {
  display: flex;
  gap: $spacing-sm;
  align-items: center;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.compareSlider input {
  flex: 1;
}

.compareTooltip {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-md;
  margin: 0;
  font-size: $font-size-xs;
}

.compareTable {
  width: 100%;
  border-collapse: collapse;
  font-size: $font-size-xs;
}

.compareTable :deep(th),
.compareTable :deep(td) {
  padding: $spacing-xs $spacing-sm;
  border-bottom: 1px solid $color-border;
  text-align: left;
}

.compareSubtitle {
  margin: $spacing-md 0 0;
  color: $color-primary;
  font-size: $font-size-base;
}

.up {
  color: $color-up;
}

.down {
  color: $color-down;
}
</style>
