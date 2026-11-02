import test from 'node:test';
import assert from 'node:assert/strict';
import { fundFxImpact } from '../src/shared/forecast-details.ts';
const row = (currency, weight, price, fx) => ({
  currency,
  weight,
  stock: { return: price },
  fx: { return: fx },
  rmbReturn: (1 + price) * (1 + fx) - 1,
});
const fund = (rows) => ({
  record: { forecast: { date: '2026-10-19', base: { date: '2026-10-16' }, model: { return: 0.01 }, rows } },
});
test('A shares have zero conversion impact; HK and US holdings use their own rates and NAV weights', () => {
  const f = fund([
    row('CNY', 50, 0.02, 0),
    row('HKD', 30, 0.1, 0.01),
    row('USD', 10, -0.1, -0.02),
    { currency: 'USD', weight: 5, rmbReturn: null },
  ]);
  const impact = fundFxImpact(f);
  assert.equal(impact.coverage, 90);
  assert.equal(impact.foreignWeight, 40);
  assert.ok(Math.abs(impact.contribution - (0.3 * 1.1 * 0.01 + 0.1 * 0.9 * -0.02)) < 1e-12);
  const price = f.record.forecast.rows.slice(0, 3).reduce((s, r) => s + (r.weight / 100) * r.stock.return, 0);
  const total = f.record.forecast.rows.slice(0, 3).reduce((s, r) => s + (r.weight / 100) * r.rmbReturn, 0);
  assert.ok(Math.abs(price + impact.contribution - total) < 1e-12);
  assert.equal(fundFxImpact(fund([row('CNY', 80, 0.02, 0)])).contribution, 0);
});
test('missing estimates remain unknown and a dollar reference cannot supply a fund contribution', () => {
  assert.equal(
    fundFxImpact({ valuationFx: { return: 0.01 }, latestHoldings: { rows: [{ weight: 100, currency: 'USD' }] } }),
    null,
  );
  assert.equal(fundFxImpact(fund([{ weight: 100, currency: 'USD', stock: { return: 0.01 }, rmbReturn: null }])), null);
});
test('index proxies label their 100 percent assumption and use the saved FX with cross term', () => {
  const f = fund([]);
  Object.assign(f.record.forecast, {
    model: { return: 0.111, method: 'index-proxy-v3' },
    indexQuote: { close: 110, baseClose: 100 },
    fx: { return: 0.01 },
  });
  const r = fundFxImpact(f);
  assert.equal(r.index, true);
  assert.equal(r.coverage, 100);
  assert.ok(Math.abs(r.contribution - 0.011) < 1e-12);
});
