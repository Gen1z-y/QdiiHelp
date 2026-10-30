<script setup lang="ts">
import { computed } from 'vue';
import type { BondFit, BondReference, FundItem } from '@/types/fund';
import { num, pct } from '@/lib/format';

/**
 * 债基「拟合与持仓」面板：展示拟合系数、样本质量、券种配置依据与披露持仓。
 * 与旧页面 bondFitPanel 文案保持一致，改为模板渲染便于后续维护。
 */
const props = defineProps<{ fund: FundItem }>();

const forecastFit = computed<BondFit | undefined>(() => props.fund.record?.forecast?.fit);
const reference = computed<BondReference | null>(() => props.fund.bondReference ?? null);
const source = computed<BondFit | BondReference | undefined>(() => forecastFit.value ?? reference.value ?? undefined);

/** v2 为持仓约束模型，系数按因子排列；v1 是固定三指数模型。 */
const isHoldingModel = computed(
  () =>
    props.fund.record?.forecast?.model?.method === 'bond-fit-v2' ||
    (!forecastFit.value && reference.value?.method === 'bond-fit-v2'),
);

const explanation = computed(() =>
  isHoldingModel.value
    ? '结合目标日前已公布的季度券种配置，用分期限国债、政策金融债、金融信用债、中票和存单财富指数拟合。按净值占比约束暴露，保留超过100%的债券敞口，以非负岭回归稳定系数，并比较不同滚动窗口。财富指数已含利息，不重复添加票息。'
    : '当前采用原国债、企债、转债三指数拟合；持仓约束候选缺数据或未通过验证时保留原模型。截距包含未被指数解释的平均收益，不能视作单独票息。',
);

/** 百分比展示系数（保留 4 位小数，便于观察小量级截距）。 */
function bp(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? (value * 100).toFixed(4) + '%' : '—';
}

const rows = computed<{ label: string; value: string }[]>(() => {
  const fit = source.value;
  const coeffs = fit?.coeffs;
  if (!fit || !Array.isArray(coeffs)) return [];
  const list: { label: string; value: string }[] = [
    { label: '拟合样本（交易日）', value: String(fit.samples ?? '—') },
    { label: '拟合优度 R²', value: num(fit.r2, 2) },
    { label: '每日残差截距（非额外票息）', value: bp(coeffs[0]) },
  ];
  if (isHoldingModel.value) {
    for (const [index, factor] of (fit.factors ?? []).entries()) {
      list.push({ label: `${factor.name} 敏感度`, value: num(coeffs[index + 1], 2) });
    }
  } else {
    list.push(
      { label: '利率敏感度（国债指数）', value: num(coeffs[1], 2) },
      { label: '信用敏感度（企债−国债）', value: num(coeffs[2], 2) },
      { label: '转债敏感度（转债−国债）', value: num(coeffs[3], 2) },
    );
  }
  for (const factor of fit.factors ?? []) {
    list.push({
      label: `${factor.name} 单日涨跌`,
      value: pct(factor.dayReturn) + (factor.carried ? `（沿用 ${factor.date}）` : ` · ${factor.date}`),
    });
  }
  return list;
});

const disclosure = computed(() => source.value?.disclosure);

const validation = computed(() => source.value?.validation ?? source.value?.adaptive?.validation);

const reason = computed(() => {
  const adaptiveReason = source.value?.adaptive?.reason;
  if (adaptiveReason) return adaptiveReason;
  const disclosures = props.fund.bondHoldings?.rows?.length;
  return disclosures ? '' : '尚未取得季度券种配置，请在基金持仓中同步；当前沿用原三指数模型';
});

const holdings = computed(() => props.fund.bondHoldings ?? null);
</script>

<template>
  <section class="bondFit">
    <h3 class="bondFitTitle">拟合说明 · {{ isHoldingModel ? '持仓约束模型' : '原三指数模型' }}</h3>
    <p class="bondFitMuted">
      {{ explanation }}
      样本至少60个且R²不低于0.3；新候选还须通过最近30日逐日验证的总体、近期及较大误差门槛。盘中仅参考，收盘确认后才封存，正式公布后分模型统计。季度持仓有滞后，历史验证不保证未来效果。
    </p>

    <p v-if="reason" class="bondFitNote">{{ reason }}</p>

    <p v-if="disclosure" class="bondFitMuted">
      本次配置依据：{{ disclosure.asOf }} 季报，{{ disclosure.publishedAt }} 公布；债券占净值
      {{ num(disclosure.categories?.total, 2) }}%。
    </p>

    <p v-if="validation" class="bondFitMuted">
      选择候选时使用此前 {{ num(validation.count, 0) }} 个净值日（{{ validation.from }} 至 {{ validation.to }}）：
      原模型平均误差 {{ num((validation.baselineMae ?? 0) * 100, 4) }}、候选
      {{ num((validation.candidateMae ?? 0) * 100, 4) }}
      个百分点。这是当前历史数据重建的模型选择结果，不是独立的未来成绩。
    </p>

    <div v-if="rows.length" class="tablewrap">
      <table class="bondFitTable">
        <thead>
          <tr>
            <th>项目</th>
            <th>数值</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.label">
            <td>{{ row.label }}</td>
            <td>{{ row.value }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="bondFitMuted">{{ reference?.unavailable ?? fund.modelError ?? '暂无拟合结果' }}</p>

    <template v-if="holdings">
      <h3 class="bondFitTitle">披露债券持仓 · {{ holdings.asOf }}</h3>
      <p class="bondFitMuted">
        前五大债券用于查看组合特征；模型约束来自季度报告的券种配置，不将前五大持仓放大为整个组合。
      </p>
      <div class="tablewrap">
        <table class="bondFitTable">
          <thead>
            <tr>
              <th>债券</th>
              <th>占净值比</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in holdings.rows" :key="row.code">
              <td>
                {{ row.name }}<small>{{ row.code }}</small>
              </td>
              <td>{{ num(row.weight, 2) }}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <p v-else class="bondFitMuted">暂无披露债券持仓。</p>

    <p v-if="fund.record?.forecast?.calculatedAt" class="bondFitMuted">
      本次预估计算于 {{ fund.record.forecast.calculatedAt }}
      <template v-if="fund.record?.sealedAt"> · 封存于 {{ fund.record.sealedAt }}</template>
      。
    </p>
  </section>
</template>

<style lang="scss" scoped>
.bondFit {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}

.bondFitTitle {
  margin: $spacing-md 0 0;
  color: $color-primary;
  font-size: $font-size-base;
}

.bondFitMuted {
  margin: 0;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.bondFitNote {
  margin: 0;
  padding: $spacing-sm $spacing-md;
  border-left: 3px solid $color-warning;
  background: $color-warning-soft;
  color: $color-warning;
  font-size: $font-size-xs;
}

.bondFitTable {
  width: 100%;
  border-collapse: collapse;
  font-size: $font-size-xs;
}

.bondFitTable th,
.bondFitTable td {
  padding: $spacing-xs $spacing-sm;
  border-bottom: 1px solid $color-border;
  text-align: left;
}

.bondFitTable small {
  display: block;
  color: $color-text-secondary;
}
</style>
