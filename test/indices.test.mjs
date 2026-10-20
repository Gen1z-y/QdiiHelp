import test from 'node:test';
import assert from 'node:assert/strict';
import {indexForFund,selectIndexClose} from '../lib/indices.mjs';
test('map only matching broad indices',()=>{
 assert.equal(indexForFund('大成纳斯达克100ETF联接(QDII)A'),'NDX');
 assert.equal(indexForFund('广发纳指100人民币A'),'NDX');
 assert.equal(indexForFund('博时标普500ETF联接A'),'SPX');
 for(const name of ['纳斯达克科技ETF','标普500等权','全球精选','纳斯达克生物科技'])assert.equal(indexForFund(name),null);
});
test('US preopen and in-progress candle never treated as a completed close',()=>{
 const rows=[{date:'2026-09-28',close:100},{date:'2026-09-29',close:102},{date:'2026-09-30',close:110}];
 for(const now of ['2026-09-30T10:00:00Z','2026-09-30T19:00:00Z']){const r=selectIndexClose(rows,'2026-09-30',new Date(now));assert.equal(r.date,'2026-09-29');assert.ok(Math.abs(r.dailyReturn-.02)<1e-12);}
 assert.equal(selectIndexClose(rows,'2026-09-30',new Date('2026-09-30T21:01:00Z')).date,'2026-09-30');
 assert.equal(selectIndexClose(rows,'2026-09-29',new Date('2026-10-01T10:00:00Z')).date,'2026-09-29');
});
test('winter closing buffer, holiday carry and missing data',()=>{
 const rows=[{date:'2026-12-23',close:100},{date:'2026-12-24',close:99},{date:'2026-12-28',close:101}];
 assert.equal(selectIndexClose(rows,'2026-12-28',new Date('2026-12-28T21:30:00Z')).date,'2026-12-24');
 assert.equal(selectIndexClose(rows,'2026-12-25',new Date('2026-12-29T00:00:00Z')).date,'2026-12-24');
 assert.throws(()=>selectIndexClose(rows.slice(0,1),'2026-12-25',new Date('2026-12-29T00:00:00Z')),/缺少/);
});
