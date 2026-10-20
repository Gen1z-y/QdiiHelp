import test from 'node:test';
import assert from 'node:assert/strict';
import {pruneOldObservations,hasOldObservations,RETENTION_DAYS} from '../lib/retention.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {forecastStats} from '../lib/forecast-stats.mjs';
import {evidenceStats} from '../lib/model-evidence.mjs';
import {forecastHistory} from '../lib/holiday-export.mjs';
import {invalidateForecasts} from '../lib/forecast-policy.mjs';
import {replaySealedForecasts} from '../lib/replay-audit.mjs';

test('旧记录转摘要，180天边界内明细保留，缓存清理可重复执行',()=>{
 assert.equal(RETENTION_DAYS,180);
 const now=new Date('2026-10-10T12:00:00Z');
 const data={records:{'111111:2026-04-12':{forecast:{rows:[{weight:10}]}},'111111:2026-04-13':{forecast:{rows:[{weight:20}]}},'111111:2026-10-09':{}},
  lastView:{'111111:2026-04-12':{},'111111:2026-10-09':{}},fxDisplay:{'2026-04-12':{},'2026-10-09':{}}};
 assert.equal(hasOldObservations(data,{now}),true);
 const removed=pruneOldObservations(data,{now});
 assert.equal(removed,3);
 assert.deepEqual(Object.keys(data.records),['111111:2026-04-12','111111:2026-04-13','111111:2026-10-09']);
 assert.equal(data.records['111111:2026-04-12'].forecast.rows,undefined);
 assert.equal(data.records['111111:2026-04-13'].forecast.rows.length,1);
 assert.deepEqual(Object.keys(data.lastView),['111111:2026-10-09']);
 assert.deepEqual(Object.keys(data.fxDisplay),['2026-10-09']);
 assert.equal(hasOldObservations(data,{now}),false);
 assert.equal(pruneOldObservations(data,{now}),0);
});

test('摘要落盘与归档整理后保留90样本、候选模型、图表及原时间戳',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-retention-'));
 try{
  const file=path.join(dir,'state.json'),store=new Store(file);
  for(let i=0;i<130;i++){
   const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10);
   const base={date:new Date(Date.UTC(2026,0,i)).toISOString().slice(0,10),value:1};
   const model={method:'market-close-v4',return:i/10000,dailyReturn:i/10000,value:1+i/10000,coverage:50};
   const f={date,base,model,calculatedAt:date+'T10:00:00Z',rows:[{code:'TEST',weight:50,padding:'x'.repeat(3000)}]};
   const e={...f,capturedAt:date+'T10:01:00Z',fingerprint:'version-1',candidate:{method:'residual-us-spx-v1',return:.01,allocation:{padding:'x'.repeat(3000)}}};
   store.data.records['111111:'+date]={forecast:f,originalForecast:f,partialForecast:f,firstForecastAt:date+'T10:00:00Z',sealedAt:date+'T10:01:00Z',firstActualSeenAt:date+'T12:00:00Z',actual:{date,previousDate:base.date,value:1,dailyReturn:.01},evidence:[e,{...e,fingerprint:'late',capturedAt:date+'T13:00:00Z'}],rejectedForecasts:[{forecast:f,reason:'test'}]};
  }
  store.data.records['111111:2026-01-01'].actual=null;
  const measurements=d=>({stats:forecastStats('111111',d.records),evidence:evidenceStats(d.records,'111111'),history:forecastHistory(d.records,'111111')});
  const before=measurements(store.data);
  assert.equal(before.stats.groups[0].windows[1].count,90);
  store.save();
  const loaded=new Store(file);
  pruneOldObservations(loaded.data,{now:new Date('2027-01-01T12:00:00Z')});
  assert.deepEqual(measurements(loaded.data),before);
  const r=loaded.data.records['111111:2026-01-02'];
  for(const key of ['forecast','originalForecast','partialForecast'])assert.equal(r[key].rows,undefined);
  assert.equal(r.evidence[0].rows,undefined);
  assert.equal(r.evidence[0].candidate.allocation,undefined);
  assert.equal(r.rejectedForecasts[0].forecast.rows,undefined);
  assert.equal(r.evidence[0].capturedAt,'2026-01-02T10:01:00Z');
  loaded.compact({force:true});
  const restarted=new Store(file);
  assert.deepEqual(measurements(restarted.data),before);
  assert.equal(invalidateForecasts(restarted.data),false);
  assert.deepEqual(measurements(restarted.data),before);
  assert.equal(replaySealedForecasts(restarted.data).checked,0);
  assert.equal(pruneOldObservations(restarted.data,{now:new Date('2027-01-01T12:00:00Z')}),0);
 }finally{
  if(path.dirname(path.resolve(dir))===path.resolve(os.tmpdir())&&path.basename(dir).startsWith('qdii-retention-'))fs.rmSync(dir,{recursive:true,force:true});
 }
});

test('仅有旧汇率缓存也触发保存',()=>{
 const data={records:{},lastView:{},fxDisplay:{'2025-01-01':{dailyReturn:0}}};
 assert.equal(pruneOldObservations(data,{now:new Date('2026-10-10T12:00:00Z')}),1);
});
