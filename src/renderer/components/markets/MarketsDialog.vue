<script setup lang="ts">
import { ref, watch } from 'vue';
import { useMarkets } from '@/composables/useMarkets';
import type { MarketItem } from '@/types/compare';
import { pct } from '@/lib/format';

/**
 * 全球指数行情：世界地图示意 + 指数点位卡片。
 * 与旧页面一致：只在打开或手动刷新时请求，进度按条推送。
 */

const { opened, items, loading, completed, total, status, load, close } = useMarkets();

const dialogRef = ref<HTMLDialogElement | null>(null);

watch(opened, (value) => {
  const dialog = dialogRef.value;
  if (!value) {
    if (dialog?.open) dialog.close();
    return;
  }
  if (!dialog?.open) dialog?.showModal();
});

/** 收盘后没有实时报价时回落到 closing。 */
function display(item: MarketItem) {
  return item.display ?? { quote: item.closing, label: '收盘行情', kind: 'closed', pointLabel: '收盘点数' };
}

function number(value?: number): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
}

function beijing(value?: string): string {
  if (!value) return '时间暂缺';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

/** 点位卡片的位置由后端给出的 x/y 百分比决定。 */
function pinStyle(item: MarketItem): Record<string, string> {
  return { left: item.x + '%', top: Math.min(82, item.y) + '%' };
}

const worldPath =
  'M65 85L128 44 237 40 306 66 293 100 254 130 228 166 197 181 211 213 178 199 139 145 94 134Z M242 212L294 221 328 258 304 321 277 378 251 331 231 266Z M327 36L389 18 418 41 381 86 347 73Z M437 96L476 60 520 77 544 113 520 144 476 139Z M468 150L541 144 580 187 559 247 523 299 486 276 465 213 445 177Z M535 71L626 37 751 47 829 65 930 113 907 149 834 167 797 219 755 195 722 149 679 171 649 208 611 164 568 143Z M790 277L860 259 911 288 900 335 839 347 798 322Z M929 337L948 319 956 353 935 376Z';
</script>

<template>
  <dialog ref="dialogRef" class="marketsDialog" @close="close">
    <div class="marketsBody">
      <div class="dialogHead">
        <div>
          <span class="marketsEyebrow">GLOBAL MARKETS</span>
          <h2 class="marketsTitle">全球指数行情</h2>
        </div>
        <div class="marketsActions">
          <button type="button" class="marketsPrimary" :disabled="loading" @click="load(true)">刷新行情</button>
          <button type="button" class="marketsSecondary" @click="dialogRef?.close()">关闭</button>
        </div>
      </div>

      <progress
        v-if="loading"
        class="marketsProgress"
        aria-label="指数加载进度"
        :max="total || 1"
        :value="total ? completed : undefined"
      />
      <p class="marketsStatus" role="status" aria-live="polite">{{ status }}</p>

      <section class="marketMap" aria-label="指数地图">
        <svg class="worldSilhouette" viewBox="0 0 1000 420" aria-hidden="true">
          <defs>
            <pattern id="worldDots" width="9" height="9" patternUnits="userSpaceOnUse">
              <circle cx="3" cy="3" r="2" fill="#c9d2e3" />
            </pattern>
          </defs>
          <path fill="url(#worldDots)" :d="worldPath" />
        </svg>
        <div v-for="item in items" :key="item.id" class="marketPin" :style="pinStyle(item)">
          <span class="marketQuoteBadge" :class="display(item).kind">{{ display(item).label }}</span>
          <span class="marketName">{{ item.name }}</span>
          <strong class="marketPoints">
            {{ number(display(item).quote?.close) }}
            <small>{{ display(item).pointLabel ?? '' }}</small>
          </strong>
          <strong :class="display(item).quote?.change! > 0 ? 'up' : display(item).quote?.change! < 0 ? 'down' : ''">
            {{ pct(display(item).quote?.change) }}
          </strong>
          <small class="marketMeta">{{
            (item.stale ? '缓存 · ' : '') + (display(item).quote?.date ?? '日期暂缺')
          }}</small>
          <small v-if="display(item).quote?.asOf" class="marketMeta"
            >北京时间 {{ beijing(display(item).quote?.asOf) }}</small
          >
        </div>
      </section>

      <p class="marketsNote">
        交易时段显示最新报价，收盘后显示最新确认的收盘价；报价可能延迟，以标注时间为准。日期按当地交易日，更新时间按北京时间。涨跌未换算成人民币。数据来自腾讯、新浪、东方财富或百度股市通，地图仅示意位置。
      </p>
    </div>
  </dialog>
</template>

<style lang="scss" scoped>
.marketsDialog {
  width: min(1160px, 95vw);
  max-height: 90vh;
  padding: 0;
  border: 1px solid $color-border;
  border-radius: $radius-lg;
  background: $color-surface;
  color: $color-text;
  overflow: hidden;
}

.marketsDialog::backdrop {
  background: rgba(23, 54, 94, 0.36);
}

.marketsBody {
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

.marketsEyebrow {
  color: $color-text-secondary;
  font-size: 11px;
  letter-spacing: 2px;
}

.marketsTitle {
  margin: 0;
  color: $color-primary;
  font-size: $font-size-title;
}

.marketsActions {
  display: flex;
  gap: $spacing-sm;
}

.marketsPrimary {
  padding: $spacing-sm $spacing-lg;
  border: 1px solid $color-primary;
  border-radius: $radius-sm;
  background: $color-primary;
  color: $color-text-inverse;
  font-size: $font-size-sm;
}

.marketsSecondary {
  padding: $spacing-sm $spacing-lg;
  border: 1px solid $color-border-strong;
  border-radius: $radius-sm;
  background: $color-surface;
  color: $color-primary;
  font-size: $font-size-sm;
}

.marketsProgress {
  width: 100%;
}

.marketsStatus {
  margin: 0;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.marketMap {
  position: relative;
  min-height: 420px;
  border: 1px solid $color-border;
  border-radius: $radius-md;
  background: $color-primary-softer;
  overflow: hidden;
}

.worldSilhouette {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.marketPin {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 126px;
  padding: $spacing-xs $spacing-sm;
  border: 1px solid $color-border;
  border-radius: $radius-sm;
  background: rgba(255, 255, 255, 0.94);
  font-size: $font-size-xs;
  transform: translate(-50%, -50%);
}

.marketQuoteBadge {
  align-self: flex-start;
  padding: 0 6px;
  border-radius: 999px;
  background: $color-primary-soft;
  color: $color-primary;
  font-size: 11px;
}

.marketName {
  color: $color-text;
  font-weight: 600;
}

.marketPoints {
  font-size: $font-size-base;
}

.marketPoints small {
  margin-left: 4px;
  color: $color-text-secondary;
  font-size: 10px;
  font-weight: 400;
}

.marketMeta {
  color: $color-text-secondary;
  font-size: 10px;
}

.marketsNote {
  margin: 0;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.up {
  color: $color-up;
}

.down {
  color: $color-down;
}
</style>
