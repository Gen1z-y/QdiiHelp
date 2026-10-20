import test from 'node:test';
import assert from 'node:assert/strict';
import {cumulativeWindow} from '../lib/cumulative-window.mjs';
const fund=(base,date)=>({date,latestNav:{date:base},record:{forecast:{base:{date:base},model:{return:.02},rows:[{stock:{target:{date}}}]}}});
test('cumulative display requires multiple weekdays awaiting NAV and updated data; weekend alone does not trigger it',()=>{
 assert.equal(cumulativeWindow(fund('2026-09-29','2026-10-02')).show,true);
 assert.equal(cumulativeWindow(fund('2026-09-18','2026-09-21')).show,false);
 assert.equal(cumulativeWindow(fund('2026-09-21','2026-09-23')).show,true);
 assert.equal(cumulativeWindow(fund('2026-09-29','2026-10-03')).show,false);
 assert.equal(cumulativeWindow(fund('2026-09-30','2026-10-01')).show,false);
 const stale=fund('2026-09-29','2026-10-02');stale.record.forecast.rows[0].stock.target.date='2026-09-29';assert.equal(cumulativeWindow(stale).show,false);
 const published=fund('2026-09-29','2026-10-02');published.latestNav.date='2026-10-02';assert.equal(cumulativeWindow(published).show,false);
});
