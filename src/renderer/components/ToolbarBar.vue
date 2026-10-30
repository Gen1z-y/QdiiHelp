<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { fetchFundProfile } from '@/services/funds';
import SelectField, { type SelectOption } from './ui/SelectField.vue';

/** 顶部工具栏：刷新、持仓/指数入口、新增基金表单与状态文本。 */
const props = defineProps<{ busy: boolean; status: string; historyText: string; existingCodes: string[] }>();
const emit = defineEmits<{
  refresh: [];
  holdings: [];
  markets: [];
  export: [];
  add: [code: string, group: 'held' | 'watch'];
}>();

const code = ref('');
const group = ref('');
const preview = ref('');
const submitting = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let lookupSeq = 0;

const groupOptions: SelectOption[] = [
  { value: 'watch', label: '自选基金' },
  { value: 'held', label: '持有基金' },
];

/** 输入 6 位代码后延迟查询名称，避免逐字请求。 */
function onCodeInput(): void {
  clearTimeout(timer);
  preview.value = '';
  const value = code.value.trim();
  if (!/^\d{6}$/.test(value)) return;
  const seq = ++lookupSeq;
  timer = setTimeout(async () => {
    try {
      const profile = await fetchFundProfile(value);
      if (seq !== lookupSeq) return;
      preview.value = profile.name + (props.existingCodes.includes(value) ? ' · 已在列表中' : '');
    } catch (error) {
      if (seq === lookupSeq) preview.value = error instanceof Error ? error.message : String(error);
    }
  }, 300);
}

async function submit(): Promise<void> {
  if (!code.value.trim() || !group.value) return;
  submitting.value = true;
  try {
    emit('add', code.value.trim(), group.value === 'held' ? 'held' : 'watch');
    code.value = '';
    group.value = '';
    preview.value = '';
  } finally {
    submitting.value = false;
  }
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <section class="toolbar">
    <div class="toolbarGroup">
      <button type="button" class="toolbarButton toolbarButtonPrimary" :disabled="busy" @click="emit('refresh')">
        <svg
          class="toolbarIcon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M20 7v5h-5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M19 12a7 7 0 1 1-2.05-4.95L20 10" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        刷新数据
      </button>
      <button type="button" class="toolbarButton" @click="emit('holdings')">基金持仓</button>
      <button type="button" class="toolbarButton" @click="emit('markets')">全球指数</button>
      <button type="button" class="toolbarButton" :disabled="busy" @click="emit('export')">导出图片</button>
    </div>

    <p class="toolbarStatus" role="status" aria-live="polite">{{ status }}</p>

    <form class="toolbarForm" @submit.prevent="submit">
      <div class="toolbarInputWrap">
        <svg
          class="toolbarInputIcon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-3.5-3.5" stroke-linecap="round" />
        </svg>
        <input
          v-model="code"
          class="toolbarInput"
          placeholder="6 位基金代码"
          inputmode="numeric"
          maxlength="6"
          pattern="[0-9]{6}"
          aria-label="新增基金代码"
          required
          @input="onCodeInput"
        />
      </div>
      <SelectField
        v-model="group"
        class="toolbarSelect"
        :options="groupOptions"
        placeholder="选择分组"
        aria-label="添加到分组"
        width="124px"
      />
      <button type="submit" class="toolbarButton toolbarButtonDark" :disabled="submitting || !group">
        ＋ 添加基金
      </button>
      <span class="toolbarPreview" role="status">{{ preview }}</span>
    </form>

    <span class="sr" role="status" aria-live="polite">{{ historyText }}</span>
  </section>
</template>

<style lang="scss" scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-md;
  align-items: center;
  padding: $spacing-md $spacing-xl;
  border-bottom: 1px solid $color-border;
  background: $color-surface;
}

.toolbarGroup {
  display: flex;
  gap: $spacing-xs;
  align-items: center;
  padding: 3px;
  border-radius: $radius-md;
  background: $color-surface-muted;
}

.toolbarButton {
  display: inline-flex;
  gap: $spacing-xs;
  align-items: center;
  padding: $spacing-sm $spacing-md;
  border-radius: $radius-sm;
  color: $color-text-secondary;
  font-size: $font-size-base;
  white-space: nowrap;
  transition:
    background-color $duration-fast $ease-out,
    color $duration-fast $ease-out,
    box-shadow $duration-fast $ease-out;

  &:hover:not(:disabled) {
    background: $color-surface;
    color: $color-primary;
    box-shadow: $shadow-xs;
  }
}

.toolbarButtonPrimary {
  background: linear-gradient(140deg, $color-primary 0%, $color-accent 100%);
  color: $color-text-inverse;
  box-shadow: $shadow-xs;

  &:hover:not(:disabled) {
    background: linear-gradient(140deg, $color-primary-strong 0%, $color-primary 100%);
    color: $color-text-inverse;
    box-shadow: $shadow-sm;
  }
}

.toolbarButtonDark {
  background: $color-primary;
  color: $color-text-inverse;

  &:hover:not(:disabled) {
    background: $color-primary-strong;
    color: $color-text-inverse;
  }
}

.toolbarIcon {
  width: 15px;
  height: 15px;
}

.toolbarStatus {
  flex: 1;
  min-width: 200px;
  color: $color-text-secondary;
  font-size: $font-size-sm;
}

.toolbarForm {
  display: flex;
  gap: $spacing-sm;
  align-items: center;
}

.toolbarInputWrap {
  position: relative;
  display: flex;
  align-items: center;
}

.toolbarInputIcon {
  position: absolute;
  left: $spacing-sm;
  width: 14px;
  height: 14px;
  color: $color-text-tertiary;
  pointer-events: none;
}

.toolbarInput {
  width: 156px;
  padding: $spacing-sm $spacing-md $spacing-sm 30px;
  border: 1px solid $color-border;
  border-radius: $radius-sm;
  background: $color-surface;
  font-size: $font-size-base;
  transition:
    border-color $duration-fast $ease-out,
    box-shadow $duration-fast $ease-out;

  &:focus {
    border-color: $color-accent;
    box-shadow: $shadow-focus;
    outline: none;
  }
}

.toolbarSelect {
  flex: none;
}

.toolbarPreview {
  min-width: 130px;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}
</style>
