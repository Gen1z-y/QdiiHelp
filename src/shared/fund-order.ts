/**
 * 自选组内的「优先区域」规则。
 *
 * 历史行为来自旧页面 public/app.js：名称命中 华夏 / 易方达 / 嘉实 的基金在自选组排前面，
 * 其余保持原有相对顺序；手动上下移动不能跨越这条边界，避免一次点击把基金挪出优先区。
 */
export const PREFERRED_WATCH_NAME = /华夏|易方达|嘉实/;

/** 该基金是否属于自选组的优先区域。 */
export function preferredWatchFund(fund: { name?: string | null } | null | undefined): boolean {
  return PREFERRED_WATCH_NAME.test(fund?.name ?? '');
}

/** 稳定排序：优先项提到前面，其余基金相对顺序不变（V8 的 sort 是稳定排序）。 */
export function sortByWatchPriority<T extends { name?: string | null }>(funds: T[]): T[] {
  return [...funds].sort((a, b) => Number(preferredWatchFund(b)) - Number(preferredWatchFund(a)));
}

/** 两只基金是否处于同一优先区域；跨区域时禁止交换位置。 */
export function sameWatchPriority(
  a: { name?: string | null } | null | undefined,
  b: { name?: string | null } | null | undefined,
): boolean {
  return preferredWatchFund(a) === preferredWatchFund(b);
}
