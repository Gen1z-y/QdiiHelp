import test from 'node:test';
import assert from 'node:assert/strict';
import {canReuseView,blocksStockModel,publicView} from '../lib/load-policy.mjs';
import {Store} from '../lib/store.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('zero direct-stock exposure never disables Nasdaq or S&P index proxies',()=>{
 for(const indexId of ['NDX','SPX'])assert.equal(blocksStockModel({indexId,nonStock:true,date:'2026-10-02'}),false);
 assert.equal(blocksStockModel({nonStock:true,date:'2026-10-02'}),true);
 assert.equal(blocksStockModel({holdingsDate:'2023-09-30',date:'2026-10-02'}),true);
});
test('fresh views may be reused, forced or expired requests and missing index predictions may not',()=>{
 const now=Date.parse('2026-10-03T05:00:00Z');const v={checkedAt:new Date(now-1000).toISOString(),record:{forecast:{model:{dailyReturn:.01}}},latestHoldings:{asOf:'2026-06-30',rows:[{weight:1}]}};
 assert.equal(canReuseView(v,null,{now}),true);assert.equal(canReuseView(v,null,{now,force:true}),false);
 assert.equal(canReuseView(v,null,{now:now+300000}),false);
 assert.equal(canReuseView(v,{asOf:'2026-09-30',rows:[{weight:1}]},{now}),false);
 assert.equal(canReuseView({...v,indexQuote:{id:'NDX'},record:{}},null,{now}),false);
});
test('public responses omit large audit snapshots without deleting persisted evidence or holdings',()=>{
 const v={record:{evidence:[{rows:[1,2,3]}],originalForecast:{rows:[1]},forecast:{rows:[{weight:3}]}},analysis:{rows:[1]},latestHoldings:{rows:[{weight:0},{weight:3}]}};
 const lean=publicView(v);assert.equal(lean.evidenceCount,1);assert.equal(lean.record.evidence,undefined);assert.equal(lean.record.originalForecast,undefined);assert.equal(lean.analysis,null);assert.equal(lean.latestHoldings.rows.length,1);assert.equal(v.record.evidence.length,1);assert.equal(v.latestHoldings.rows.length,2);
});
test('compact persistence stores audit evidence once and restores view records on restart',()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'qdii-compact-')),'state.json');const s=new Store(file);
 const record={forecast:{model:{dailyReturn:.01}},evidence:[{capturedAt:'test',rows:[1,2,3]}],originalForecast:{model:{value:1}}};
 s.data.records['123456:2026-10-02']=record;s.data.lastView['123456:2026-10-02']={code:'123456',date:'2026-10-02',record,analysis:{rows:[1,2,3]}};
 s.save();const disk=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(disk.lastView['123456:2026-10-02'].record,undefined);assert.ok(disk.records['123456:2026-10-02'].evidence[0].$archive);assert.equal(disk.storageVersion,3);
 const restored=new Store(file);assert.deepEqual(restored.data.records['123456:2026-10-02'].evidence,record.evidence);assert.equal(restored.data.lastView['123456:2026-10-02'].record,restored.data.records['123456:2026-10-02']);assert.equal(restored.data.records['123456:2026-10-02'].originalForecast.model.value,1);
});

test('published target skips upstream after TTL while forced, failed and new targets still refresh',()=>{
 const v={date:'2026-10-13',checkedAt:'2026-10-13T00:00:00Z',record:{actual:{date:'2026-10-13',value:1.02}},latestHoldings:{fetchedAt:'2026-01-01'}};
 const now=Date.parse('2026-10-20T00:00:00Z');
 assert.equal(canReuseView(v,null,{now}),true);
 for(const change of [{error:'offline'},{stale:true},{date:'2026-10-14'},{record:{actual:{date:v.date,value:0}}}])assert.equal(canReuseView({...v,...change},null,{now}),false);
 assert.equal(canReuseView(v,null,{now,force:true}),false);
});
