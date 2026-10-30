<script setup lang="ts">
import { ref, watch } from 'vue';
import { useHoldings } from '@/composables/useHoldings';

/**
 * 持仓变化弹窗：对比上次披露、展示公告原文链接。
 * 对比表与公告列表都由 src/shared/holdings-ui.ts 生成。
 */

const {
  changesItem,
  changesHtml,
  changesMeta,
  announcementsHtml,
  announcementLoading,
  announcementError,
  announcementListUrl,
  closeChanges,
  openChanges,
} = useHoldings();

const dialogRef = ref<HTMLDialogElement | null>(null);

watch(changesItem, (item) => {
  const dialog = dialogRef.value;
  if (!dialog) return;
  if (item && !dialog.open) dialog.showModal();
  else if (!item && dialog.open) dialog.close();
});

function retry(): void {
  if (changesItem.value) void openChanges(changesItem.value);
}
</script>

<template>
  <dialog ref="dialogRef" class="changesDialog" @close="closeChanges">
    <div class="changesBody">
      <div class="dialogHead">
        <h2 class="changesTitle">持仓变化{{ changesItem ? ' · ' + changesItem.name : '' }}</h2>
        <button type="button" class="changesClose" @click="dialogRef?.close()">关闭</button>
      </div>

      <p class="changesMeta">{{ changesMeta }}</p>

      <div v-html="changesHtml" />

      <section class="changesAnnouncements">
        <h3 class="changesSubtitle">持仓公告原文</h3>
        <div v-if="announcementLoading" class="changesMuted">正在查找对应披露期的公告原文…</div>
        <div v-else-if="announcementError" class="changesError">
          {{ announcementError }}。
          <button type="button" class="changesRetry" @click="retry">重试获取公告</button>
        </div>
        <div v-else v-html="announcementsHtml" />
        <a
          v-if="announcementListUrl"
          class="changesListLink"
          :href="announcementListUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          查看该基金全部定期公告 ↗
        </a>
      </section>
    </div>
  </dialog>
</template>

<style lang="scss" scoped>
.changesDialog {
  width: min(860px, 92vw);
  max-height: 86vh;
  padding: 0;
  border: 1px solid $color-border;
  border-radius: $radius-lg;
  background: $color-surface;
  color: $color-text;
  overflow: hidden;
}

.changesDialog::backdrop {
  background: rgba(23, 54, 94, 0.42);
}

.changesBody {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
  max-height: 86vh;
  padding: $spacing-lg;
  overflow-y: auto;
}

.dialogHead {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.changesTitle {
  margin: 0;
  color: $color-primary;
  font-size: $font-size-lg;
}

.changesClose {
  padding: $spacing-sm $spacing-lg;
  border: 1px solid $color-border-strong;
  border-radius: $radius-sm;
  background: $color-surface;
  color: $color-primary;
  font-size: $font-size-sm;
}

.changesMeta,
.changesMuted {
  margin: 0;
  color: $color-text-secondary;
  font-size: $font-size-xs;
}

.changesError {
  display: flex;
  gap: $spacing-sm;
  align-items: center;
  color: $color-warning;
  font-size: $font-size-xs;
}

.changesRetry {
  padding: 2px $spacing-sm;
  border: 1px solid $color-border-strong;
  border-radius: $radius-sm;
  background: $color-surface;
  color: $color-primary;
}

.changesAnnouncements {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
  padding-top: $spacing-md;
  border-top: 1px solid $color-border;
}

.changesSubtitle {
  margin: 0;
  color: $color-primary;
  font-size: $font-size-sm;
}

.changesListLink {
  color: $color-primary;
  font-size: $font-size-xs;
}
</style>
