import { ref } from 'vue';
import type { FundItem } from '@/types/fund';
import { buildExportImage } from '@/lib/export-image';
import { api } from '@/services/client';
import { navReturnValue, pct } from '@/lib/format';
import { navPeriodLabel } from '@/lib/estimate';
import { drawHolidayExport } from '@shared/holiday-export.ts';

/**
 * 图片导出：生成 PNG 后弹预览，用户再决定下载。
 * 绘制细节在 lib/export-image.ts，假期分支复用 shared 的绘制函数。
 */

const busy = ref(false);
const previewOpen = ref(false);
const dataUrl = ref('');
const fileName = ref('');
const error = ref('');

async function run(items: FundItem[]): Promise<void> {
  if (busy.value) return;
  if (!items.length) {
    error.value = '请等待基金数据加载完成后再导出';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const result = await buildExportImage(
      items,
      {
        pct,
        navPeriodLabel,
        navReturnValue,
        drawHolidayExport: drawHolidayExport as never,
        document,
      },
      api,
    );
    dataUrl.value = result.dataUrl;
    const today = new Date().toISOString().slice(0, 10);
    fileName.value = `${result.holiday ? '假期预估-' : '基金涨跌-'}${today}.png`;
    previewOpen.value = true;
  } catch (failure) {
    error.value = '图片导出失败：' + (failure instanceof Error ? failure.message : String(failure));
  } finally {
    busy.value = false;
  }
}

function closePreview(): void {
  previewOpen.value = false;
}

export function useExport() {
  return { busy, previewOpen, dataUrl, fileName, error, run, closePreview };
}
