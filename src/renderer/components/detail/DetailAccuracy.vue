<script setup lang="ts">
import { computed } from 'vue';
import type { FundItem } from '@/types/fund';
import { accuracyPanel, reliabilityPanel } from '@/lib/estimate';

/** 准确性 tab：数据检查（可靠性）+ 逐模型误差统计。 */
const props = defineProps<{ fund: FundItem }>();

const html = computed(() => reliabilityPanel(props.fund) + accuracyPanel(props.fund.stats));
</script>

<template>
  <section class="accuracyPanel" v-html="html" />
</template>
