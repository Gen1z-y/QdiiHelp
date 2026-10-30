<script setup lang="ts">
import { ref, watch } from 'vue';
import { useExport } from '@/composables/useExport';

/** 导出图片预览：确认后通过 <a download> 交给浏览器/Electron 保存。 */
const { previewOpen, dataUrl, fileName, closePreview } = useExport();
const dialogRef = ref<HTMLDialogElement | null>(null);

watch(previewOpen, (value) => {
  const dialog = dialogRef.value;
  if (!dialog) return;
  if (value && !dialog.open) dialog.showModal();
  else if (!value && dialog.open) dialog.close();
});
</script>

<template>
  <dialog ref="dialogRef" class="exportDialog" @close="closePreview">
    <div class="dialogHead">
      <h2 class="exportTitle">涨跌图片预览</h2>
      <div class="exportActions">
        <a class="exportDownload" :href="dataUrl" :download="fileName">下载 PNG 图片</a>
        <button type="button" class="exportClose" @click="dialogRef?.close()">关闭</button>
      </div>
    </div>
    <div class="exportPreviewBody" tabindex="0" aria-label="涨跌图片，可滚动查看">
      <img class="exportPreviewImage" :src="dataUrl" alt="基金预估与实际涨跌列表图片" />
    </div>
  </dialog>
</template>

<style lang="scss" scoped>
.exportDialog {
  width: min(1100px, 94vw);
  height: 90vh;
  padding: 0;
  border: 1px solid $color-border;
  border-radius: $radius-lg;
  background: $color-surface;
  color: $color-text;
  overflow: hidden;
}

.exportDialog::backdrop {
  background: rgba(23, 54, 94, 0.36);
}

.dialogHead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: $spacing-md $spacing-lg;
  border-bottom: 1px solid $color-border;
}

.exportTitle {
  margin: 0;
  color: $color-primary;
  font-size: $font-size-lg;
}

.exportActions {
  display: flex;
  gap: $spacing-sm;
  align-items: center;
}

.exportDownload {
  padding: $spacing-sm $spacing-lg;
  border-radius: $radius-sm;
  background: $color-primary;
  color: $color-text-inverse;
  font-size: $font-size-sm;
  text-decoration: none;
}

.exportClose {
  padding: $spacing-sm $spacing-lg;
  border: 1px solid $color-border-strong;
  border-radius: $radius-sm;
  background: $color-surface;
  color: $color-primary;
  font-size: $font-size-sm;
}

.exportPreviewBody {
  height: calc(100% - 64px);
  padding: $spacing-md;
  overflow: auto;
  background: $color-bg;
}

.exportPreviewImage {
  max-width: 100%;
  border-radius: $radius-sm;
  background: $color-surface;
}
</style>
