import type { DetailHistory, FundItem, FundStats } from '@/types/fund';
import { pct } from './format';

/**
 * 历史校准参考：用同一模型的历史偏差对当前预估值做一次性修正提示。
 * 不是置信区间，也不保证本次误差范围，仅作参考。
 */

export interface Calibration {
  corrected: number;
  bias: number;
  mae: number;
  count: number;
  title: string;
}

export function calibrationInfo(f: FundItem, shown?: number | null, history?: DetailHistory): Calibration | null {
  if (typeof shown !== 'number' || !Number.isFinite(shown)) return null;
  const method = f.record?.forecast?.model?.method;
  const stats: FundStats | undefined = history?.stats ?? f.stats;
  const group = (stats?.groups ?? []).find((item) => item.method === method);
  const window = group?.windows?.[0];
  if (!window || (window.count ?? 0) < 10 || !Number.isFinite(window.bias) || !Number.isFinite(window.mae)) return null;
  const bias = window.bias as number;
  const mae = window.mae as number;
  const count = window.count as number;
  return {
    corrected: shown - bias / 100,
    bias,
    mae,
    count,
    title:
      `历史校准参考：预估 ${pct(shown)} − 偏差 ${bias > 0 ? '+' : ''}${bias.toFixed(2)}pp；` +
      `历史平均绝对误差 ${mae.toFixed(2)}pp（近 ${count} 次）；不是置信区间，不保证本次误差范围`,
  };
}
