import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadState } from '../src/shared/read-state.ts';

/**
 * 卡片红点：与旧页面 qdii-seen / qdii-nav-alerts 行为一致。
 * - 新公布净值提醒，悬停或打开详情后变为已读；
 * - 同一只基金在持有/自选/债基共享已读状态；
 * - 红点只在首次发现当天有效，跨天自动消失；
 * - 缺涨跌的公布日不点亮，补全后仍能提醒；
 * - 历史数据不能把已读日期改回更早。
 */

function memoryStorage() {
  const data = {};
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

function fund(overrides = {}) {
  return {
    code: '123456',
    group: 'watch',
    latestNav: { date: '2026-10-14', value: 1, dailyReturn: 0.01 },
    record: { actual: null },
    ...overrides,
  };
}

test('全新安装不会凭空亮红点', () => {
  const storage = memoryStorage();
  const state = createReadState({ storage, today: () => '2026-10-15' });
  state.initialize([fund()]);
  assert.equal(state.unseen(fund()), false);
  assert.equal(state.unseen(fund({ bond: true, group: 'held' })), false);
});

test('新公布净值点亮红点，悬停后三个分组同时已读', () => {
  const storage = memoryStorage();
  const state = createReadState({ storage, today: () => '2026-10-15' });
  state.initialize([fund()]);

  const next = fund({ latestNav: { date: '2026-10-15', value: 1, dailyReturn: 0.02 } });
  assert.equal(state.unseen(next), true);
  assert.equal(state.unseen(next, 'held'), true);
  assert.equal(state.unseen(next, 'bond'), true);

  state.markSeen(next);
  assert.equal(state.unseen(next), false);
  assert.equal(state.unseen(next, 'held'), false);
  assert.equal(state.unseen(next, 'bond'), false);
  assert.equal(state.snapshot()['123456'].actual, '2026-10-15');
});

test('红点只在首次发现当天有效，跨天自动消失', () => {
  let day = '2026-10-15';
  const state = createReadState({ storage: memoryStorage(), today: () => day });
  state.initialize([fund()]);

  const next = fund({ latestNav: { date: '2026-10-16', value: 1, dailyReturn: 0.02 } });
  assert.equal(state.unseen(next), true);
  day = '2026-10-16';
  assert.equal(state.unseen(next), false, '第二天不应继续挂着红点');
});

test('缺涨跌的公布日不点亮，补全后提醒', () => {
  const state = createReadState({ storage: memoryStorage(), today: () => '2026-10-17' });
  const partial = fund({ latestNav: { date: '2026-10-16', value: 1, dailyReturn: null } });
  state.initialize([partial]);
  assert.equal(state.unseen(partial), false);

  const complete = fund({ latestNav: { date: '2026-10-16', value: 1, dailyReturn: 0.03 } });
  assert.equal(state.unseen(complete), true);
});

test('较早的历史数据不会把已读日期改回更早', () => {
  const state = createReadState({ storage: memoryStorage(), today: () => '2026-10-16' });
  state.initialize([fund()]);
  state.markSeen(fund({ latestNav: { date: '2026-10-15', value: 1, dailyReturn: 0.02 } }));
  state.markSeen(fund({ latestNav: { date: '2026-10-10', value: 1, dailyReturn: 0.01 } }));
  assert.equal(state.snapshot()['123456'].actual, '2026-10-15');
});

test('旧版本遗留的 dotTestUnread 会被清理，不产生假红点', () => {
  const storage = memoryStorage();
  storage.setItem('qdii-seen', JSON.stringify({ 123456: { dotTestUnread: true } }));
  const state = createReadState({ storage, today: () => '2026-10-15' });
  state.initialize([fund()]);
  assert.equal(state.unseen(fund()), false);
  assert.equal(state.snapshot()['123456'].dotTestUnread, undefined);
  assert.equal(state.snapshot()['123456'].actual, '2026-10-14');
});
