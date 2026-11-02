<script setup lang="ts">
import { computed } from 'vue';
import type { StreamProgress } from '@/types/fund';

/** 刷新进度条：total 为 null 时显示为不确定进度。 */
const props = defineProps<{ progress: StreamProgress | null }>();

const text = computed(() => {
  const p = props.progress;
  if (!p) return '';
  if (p.total === null) return '正在准备获取基金信息…';
  const percent = p.total ? Math.floor((p.completed / p.total) * 100) : 100;
  return (
    `获取基金信息：${p.completed} / ${p.total} 只 · ${percent}%` +
    (p.code ? ' · ' + p.code + ' ' + p.name : '') +
    (p.stage ? ' · ' + p.stage : '')
  );
});
</script>

<template>
  <section v-if="progress" class="progressBar" aria-label="获取基金信息进度">
    <div class="progressBarTrack">
      <div
        class="progressBarFill"
        :class="{ progressBarFillIndeterminate: progress.total === null }"
        :style="
          progress.total === null ? undefined : { width: `${(progress.completed / (progress.total || 1)) * 100}%` }
        "
      />
    </div>
    <span class="progressBarText" role="status" aria-live="polite">{{ text }}</span>
  </section>
</template>

<style lang="scss" scoped>
.progressBar {
  display: flex;
  gap: $spacing-md;
  align-items: center;
  padding: $spacing-sm $spacing-xl;
  border-bottom: 1px solid $color-border;
  background: $color-surface;
}

.progressBarTrack {
  position: relative;
  flex: none;
  width: 200px;
  height: 4px;
  border-radius: $radius-pill;
  background: $color-border;
  overflow: hidden;
}

.progressBarFill {
  height: 100%;
  border-radius: $radius-pill;
  background: linear-gradient(90deg, $color-primary 0%, $color-accent 100%);
  transition: width $duration-base $ease-out;
}

.progressBarFillIndeterminate {
  width: 40%;
  animation: progressBarSlide 1.1s ease-in-out infinite;
}

@keyframes progressBarSlide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}

.progressBarText {
  color: $color-text-secondary;
  font-size: $font-size-sm;
}
</style>
