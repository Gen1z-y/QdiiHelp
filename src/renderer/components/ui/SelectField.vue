<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * 自定义下拉框，替代原生 select：
 * - 外观与界面统一（原生 select 在 Windows 上无法定制边框与箭头样式）
 * - 键盘可用：Enter/Space/↓ 打开，↑↓ 移动，Enter 选中，Esc 关闭并归还焦点
 * - 无障碍：button[aria-haspopup=listbox] + listbox/option 语义
 */
const props = withDefaults(
  defineProps<{
    modelValue: string | null;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    ariaLabel?: string;
    width?: string;
    align?: 'left' | 'right';
  }>(),
  { placeholder: '请选择', disabled: false, ariaLabel: '', width: '', align: 'left' },
);

const emit = defineEmits<{ 'update:modelValue': [string] }>();

const open = ref(false);
const activeIndex = ref(-1);
const dropUp = ref(false);
const listStyle = ref<Record<string, string>>({});
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const list = ref<HTMLUListElement | null>(null);
/** 面板挂载点：弹窗内优先（modal dialog 在 top layer，挂到 body 会被遮挡）。 */
const teleportTarget = ref<HTMLElement>(document.body);

const current = computed(() => props.options.find((option) => option.value === props.modelValue) ?? null);

/**
 * 计算下拉面板的 fixed 定位（Teleport 到 body，避免被弹窗 overflow 裁剪）：
 * 下方空间不足且上方更宽裕时向上展开。
 */
function updateListPosition(): void {
  const rect = trigger.value?.getBoundingClientRect();
  if (!rect) return;
  const alignRight = props.align === 'right';
  listStyle.value = {
    position: 'fixed',
    left: alignRight ? 'auto' : `${Math.round(rect.left)}px`,
    right: alignRight ? `${Math.round(window.innerWidth - rect.right)}px` : 'auto',
    minWidth: `${Math.round(rect.width)}px`,
    ...(dropUp.value
      ? { bottom: `${Math.round(window.innerHeight - rect.top + 6)}px` }
      : { top: `${Math.round(rect.bottom + 6)}px` }),
  };
}

/** 打开时判断下方空间是否足够，不足且上方更宽裕时向上展开。 */
function updateDropDirection(): void {
  const rect = trigger.value?.getBoundingClientRect();
  if (!rect) {
    dropUp.value = false;
    return;
  }
  const estimate = Math.min(props.options.length * 33 + 8, 280) + 6;
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  dropUp.value = spaceBelow < estimate && spaceAbove > spaceBelow;
}

async function toggle(): Promise<void> {
  if (props.disabled) return;
  open.value = !open.value;
  if (open.value) {
    updateDropDirection();
    updateListPosition();
    activeIndex.value = props.options.findIndex((option) => option.value === props.modelValue);
    await nextTick();
    // 渲染后按实际高度再校正一次位置（选项较多时估算可能偏小）
    const height = list.value?.offsetHeight ?? 0;
    if (height && !dropUp.value) {
      const rect = trigger.value?.getBoundingClientRect();
      if (rect && rect.bottom + 6 + height > window.innerHeight && rect.top > window.innerHeight - rect.bottom) {
        dropUp.value = true;
        updateListPosition();
      }
    }
  }
}

function select(option: SelectOption): void {
  if (props.disabled) return;
  emit('update:modelValue', option.value);
  open.value = false;
  trigger.value?.focus();
}

function move(step: number): void {
  if (!props.options.length) return;
  const count = props.options.length;
  activeIndex.value = (activeIndex.value + step + count) % count;
}

function onKeydown(event: KeyboardEvent): void {
  if (props.disabled) return;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      if (!open.value) toggle();
      else move(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      if (!open.value) toggle();
      else move(-1);
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      if (open.value && activeIndex.value >= 0) select(props.options[activeIndex.value]);
      else toggle();
      break;
    case 'Escape':
      if (open.value) {
        event.preventDefault();
        open.value = false;
        trigger.value?.focus();
      }
      break;
    case 'Tab':
      open.value = false;
      break;
  }
}

/** 点击外部关闭（捕获阶段；面板已 Teleport 到 body，需一并视为内部区域）。 */
function onPointerDown(event: PointerEvent): void {
  if (!open.value) return;
  const target = event.target as Node;
  const insideRoot = root.value?.contains(target) ?? false;
  const insideList = list.value?.contains(target) ?? false;
  if (!insideRoot && !insideList) open.value = false;
}

/** 滚动或调整窗口时跟随触发器位置，避免面板漂移。 */
function onReposition(): void {
  if (!open.value) return;
  updateDropDirection();
  updateListPosition();
}

onMounted(() => {
  teleportTarget.value = trigger.value?.closest('dialog') ?? document.body;
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('scroll', onReposition, true);
  window.addEventListener('resize', onReposition);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('scroll', onReposition, true);
  window.removeEventListener('resize', onReposition);
});
</script>

<template>
  <div ref="root" class="selectField" :class="{ 'selectField-open': open }" :style="width ? { width } : {}">
    <button
      ref="trigger"
      type="button"
      class="selectFieldTrigger"
      :disabled="disabled"
      :aria-label="ariaLabel || undefined"
      :aria-haspopup="'listbox'"
      :aria-expanded="open"
      aria-controls="selectFieldListbox"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span class="selectFieldValue" :class="{ selectFieldPlaceholder: !current }">
        {{ current?.label ?? placeholder }}
      </span>
      <svg
        class="selectFieldArrow"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <Teleport :to="teleportTarget">
      <transition name="selectFieldPop">
        <ul
          v-if="open"
          id="selectFieldListbox"
          ref="list"
          class="selectFieldList"
          role="listbox"
          :aria-label="ariaLabel || undefined"
          :style="listStyle"
        >
        <li
          v-for="(option, index) in options"
          :key="option.value"
          class="selectFieldOption"
          :class="{
            selectFieldOptionActive: index === activeIndex,
            selectFieldOptionSelected: option.value === modelValue,
          }"
          role="option"
          :aria-selected="option.value === modelValue"
          @mouseenter="activeIndex = index"
          @click="select(option)"
        >
          <span class="selectFieldOptionLabel">{{ option.label }}</span>
          <small v-if="option.hint" class="selectFieldOptionHint">{{ option.hint }}</small>
          <svg
            v-if="option.value === modelValue"
            class="selectFieldCheck"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            aria-hidden="true"
          >
            <path d="m5 13 4 4L19 7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </li>
        </ul>
      </transition>
    </Teleport>
  </div>
</template>

<style lang="scss" scoped>
.selectField {
  position: relative;
  display: inline-block;
}

.selectFieldTrigger {
  display: inline-flex;
  gap: $spacing-sm;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-width: 120px;
  padding: $spacing-sm $spacing-md;
  border: 1px solid $color-border;
  border-radius: $radius-sm;
  background: $color-surface;
  color: $color-text;
  font-size: $font-size-base;
  text-align: left;
  transition:
    border-color $duration-fast $ease-out,
    box-shadow $duration-fast $ease-out,
    background-color $duration-fast $ease-out;

  &:hover:not(:disabled) {
    border-color: $color-border-strong;
    background: $color-surface-muted;
  }

  &:focus-visible {
    border-color: $color-accent;
    box-shadow: $shadow-focus;
    outline: none;
  }
}

.selectField-open .selectFieldTrigger {
  border-color: $color-accent;
  box-shadow: $shadow-focus;
}

.selectFieldValue {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selectFieldPlaceholder {
  color: $color-text-tertiary;
}

.selectFieldArrow {
  flex: none;
  width: 14px;
  height: 14px;
  color: $color-text-tertiary;
  transition: transform $duration-fast $ease-out;
}

.selectField-open .selectFieldArrow {
  transform: rotate(180deg);
}

/* 面板 Teleport 到 dialog/body，fixed 定位与坐标由内联样式计算 */
.selectFieldList {
  position: fixed;
  z-index: $z-dropdown;
  min-width: 100%;
  max-height: 280px;
  margin: 0;
  padding: $spacing-xs;
  border: 1px solid $color-border;
  border-radius: $radius-md;
  background: $color-surface;
  box-shadow: $shadow-md;
  list-style: none;
  overflow-y: auto;
}

.selectFieldOption {
  display: flex;
  gap: $spacing-sm;
  align-items: center;
  padding: $spacing-sm $spacing-md;
  border-radius: $radius-xs;
  color: $color-text;
  font-size: $font-size-base;
  cursor: pointer;
  white-space: nowrap;
}

.selectFieldOptionActive {
  background: $color-primary-soft;
}

.selectFieldOptionSelected {
  color: $color-primary;
  font-weight: 600;
}

.selectFieldOptionHint {
  color: $color-text-tertiary;
  font-size: $font-size-xs;
}

.selectFieldCheck {
  flex: none;
  width: 14px;
  height: 14px;
  margin-left: auto;
  color: $color-accent;
}

.selectFieldPop-enter-active,
.selectFieldPop-leave-active {
  transition:
    opacity $duration-fast $ease-out,
    transform $duration-fast $ease-out;
}

.selectFieldPop-enter-from,
.selectFieldPop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
