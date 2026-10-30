import type { CompareMode, CompareResult } from '@/types/compare';
import { pct } from './format';

/**
 * 对比走势图：纯函数生成 SVG 与摘要数据（来自旧 history.js 的绘制逻辑），
 * 便于单元测试与组件复用；日期缺失处断开折线，不做插值。
 */

export const SERIES_COLORS = ['#e26d49', '#357ce0', '#2c9d7a', '#9b68bc', '#b38300', '#c34f88', '#168eaa', '#596579'];

const WIDTH = 1000;
const HEIGHT = 310;
const PADDING = { left: 68, right: 20, top: 20, bottom: 36 };

/** 顶部状态说明：比较区间、可比较日期数与数据来源提示。 */
export function compareStatusText(result: CompareResult): string {
  return (
    `比较日期 ${result.base} 至 ${result.end} · ${result.dates.length} 个可比较的日期` +
    (result.series.some((series) => series.derivedDates?.length)
      ? ' · 部分缺失日涨幅已按单位/累计净值补算，存在舍入和分红处理误差'
      : '') +
    (result.series.some((series) => series.stale) ? ' · 部分数据源更新失败，正在使用本地历史缓存' : '')
  );
}

/** 折线图 SVG。 */
export function buildCompareSvg(result: CompareResult, mode: CompareMode): string {
  const values = result.series
    .flatMap((series) => series.points.map((point) => point[mode]))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const min = values.reduce((left, right) => Math.min(left, right), 0);
  const max = values.reduce((left, right) => Math.max(left, right), 0);
  const span = max - min || 0.02;
  const low = min - span * 0.12;
  const high = max + span * 0.12;
  const { left, right, top, bottom } = PADDING;
  const x = (index: number): number => left + (index * (WIDTH - left - right)) / Math.max(1, result.dates.length - 1);
  const y = (value: number): number => top + ((high - value) / (high - low)) * (HEIGHT - top - bottom);

  const parts: string[] = [
    `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${mode === 'daily' ? '每日' : '累计'}涨跌幅曲线">`,
  ];
  for (let i = 0; i <= 4; i += 1) {
    const value = low + ((high - low) * i) / 4;
    const yy = y(value);
    parts.push(
      `<line x1="${left}" x2="${WIDTH - right}" y1="${yy}" y2="${yy}" stroke="#e8ede7"/>` +
        `<text x="${left - 10}" y="${yy + 4}" text-anchor="end" fill="#849286" font-size="12">${pct(value)}</text>`,
    );
  }
  parts.push(
    `<line x1="${left}" x2="${WIDTH - right}" y1="${y(0)}" y2="${y(0)}" stroke="#a7b9ad" stroke-dasharray="4 4"/>`,
  );
  result.series.forEach((series, seriesIndex) => {
    let path = '';
    let connected = false;
    series.points.forEach((point, pointIndex) => {
      const value = point[mode];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        connected = false;
        return;
      }
      path += (connected ? ' L' : ' M') + x(pointIndex).toFixed(2) + ' ' + y(value).toFixed(2);
      connected = true;
    });
    parts.push(
      `<path d="${path}" fill="none" stroke="${SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}" stroke-width="2.5"/>`,
    );
  });
  parts.push(
    `<text x="${left}" y="${HEIGHT - 8}" fill="#849286" font-size="12">${result.base}</text>` +
      `<text x="${WIDTH - right}" y="${HEIGHT - 8}" text-anchor="end" fill="#849286" font-size="12">${result.end}</text></svg>`,
  );
  return parts.join('');
}

/** 底部摘要表（区间涨跌、最大回撤、数据时间）。 */
export function compareSummary(result: CompareResult): {
  code: string;
  name: string;
  totalReturn?: number;
  maxDrawdown?: number;
  fetchedAt?: string;
  stale?: boolean;
}[] {
  return result.series.map((series) => ({
    code: series.code,
    name: series.name,
    totalReturn: series.totalReturn,
    maxDrawdown: series.maxDrawdown,
    fetchedAt: series.fetchedAt,
    stale: series.stale,
  }));
}

/** 拖动日期滑杆时的点位摘要。 */
export function compareTooltip(
  result: CompareResult,
  index: number,
  mode: CompareMode,
): { date: string; values: { code: string; value?: number | null }[] } {
  const safeIndex = Math.max(0, Math.min(result.dates.length - 1, index));
  return {
    date: result.dates[safeIndex] ?? '',
    values: result.series.map((series) => ({ code: series.code, value: series.points[safeIndex]?.[mode] })),
  };
}
