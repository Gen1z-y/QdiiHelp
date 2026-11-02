import test from 'node:test';
import assert from 'node:assert/strict';
import { preferredWatchFund, sameWatchPriority, sortByWatchPriority } from '../src/shared/fund-order.ts';

/**
 * 自选组的优先区域：名称命中 华夏 / 易方达 / 嘉实 的基金排在前面，
 * 其余保持原顺序；上下移动不能跨越这条边界。
 */

const funds = [
  { code: '1', name: '普通基金', group: 'watch', navEstimate: { return: 0.8 } },
  { code: '2', name: '嘉实债券', group: 'watch', bond: true, navEstimate: { return: 0.1 } },
  { code: '3', name: '华夏基金', group: 'watch', navEstimate: { return: 0.3 } },
  { code: '4', name: '易方达基金', group: 'watch', navEstimate: { return: 0.2 } },
  { code: '5', name: '其他基金', group: 'watch', navEstimate: { return: 0.9 } },
];

test('自选名称优先且稳定排序，不改变原数组', () => {
  assert.deepEqual(
    sortByWatchPriority(funds).map((f) => f.code),
    ['2', '3', '4', '1', '5'],
  );
  assert.deepEqual(
    funds.map((f) => f.code),
    ['1', '2', '3', '4', '5'],
    '排序不能就地修改传入数组',
  );
});

test('优先区按名称识别，边界不可跨越', () => {
  assert.equal(preferredWatchFund({ name: '嘉实债券' }), true);
  assert.equal(preferredWatchFund({ name: '易方达基金' }), true);
  assert.equal(preferredWatchFund({ name: '华夏基金' }), true);
  assert.equal(preferredWatchFund({ name: '普通基金' }), false);
  assert.equal(preferredWatchFund(undefined), false);

  // 优先区内部可以互移
  assert.equal(sameWatchPriority(funds[2], funds[3]), true);
  // 非优先区内部可以互移
  assert.equal(sameWatchPriority(funds[0], funds[4]), true);
  // 跨边界禁止
  assert.equal(sameWatchPriority(funds[3], funds[0]), false);
  assert.equal(sameWatchPriority(funds[0], funds[1]), false);
});
