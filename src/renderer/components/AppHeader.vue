<script setup lang="ts">
/** 顶部品牌区：左侧标识与标题，右侧一行使用提示。 */
</script>

<template>
  <header class="appHeader">
    <div class="appHeaderBrand">
      <span class="appHeaderMark">Q</span>
      <div class="appHeaderText">
        <h1 class="appHeaderTitle">净值观察台</h1>
        <span class="appHeaderSub">QDII HELP · 收盘之后，有据可查</span>
      </div>
    </div>
    <p class="appHeaderHint">数据仅在手动刷新时更新</p>
  </header>
</template>

<style lang="scss" scoped>
.appHeader {
  display: flex;
  gap: $spacing-lg;
  align-items: center;
  justify-content: space-between;
  padding: $spacing-md $spacing-xl;
  border-bottom: 1px solid $color-border;
  background: linear-gradient(180deg, $color-surface 0%, $color-primary-softer 100%);
}

.appHeaderBrand {
  display: flex;
  gap: $spacing-md;
  align-items: center;
}

.appHeaderMark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: $radius-md;
  background: linear-gradient(140deg, $color-primary 0%, $color-accent 100%);
  color: $color-text-inverse;
  font-size: $font-size-lg;
  font-weight: 700;
  letter-spacing: 0.5px;
  box-shadow: $shadow-sm;
}

.appHeaderText {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.appHeaderTitle {
  color: $color-primary;
  font-size: $font-size-lg;
  letter-spacing: 0.4px;
}

.appHeaderSub {
  color: $color-text-tertiary;
  font-size: $font-size-xs;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}

.appHeaderHint {
  color: $color-text-tertiary;
  font-size: $font-size-xs;
}
</style>
