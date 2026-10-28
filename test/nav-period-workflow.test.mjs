import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadState} from '../lib/storage-format.mjs';

test('逐基金非估值安排、多期延迟公布、晚到正式基准和封存预测在完整API链路中一致',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-period-workflow-'));
 process.env.PORT='0';process.env.QDII_STORAGE='json';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 const rule={source:'fixture:manager-notice',from:'2026-01-01',to:'2026-12-31',nonValuationDates:['2026-10-19']};
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:['123456'],records:{},lastView:{},fundValuationRules:{'123456':rule}}));
 const RealDate=Date,realFetch=globalThis.fetch;let clock='2026-10-20T10:00:00+08:00',published='2026-10-16',app,origin;
 globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[clock]));}static now(){return RealDate.parse(clock);}};
 const days=['2026-10-14','2026-10-15','2026-10-16','2026-10-19','2026-10-20','2026-10-21','2026-10-22'];
 const values=[98,99,100,101,104,105,106],navDays=['2026-10-14','2026-10-15','2026-10-16','2026-10-20','2026-10-21'];
 globalThis.fetch=async(input,options)=>{
  const url=String(input);if(url.startsWith('http://127.0.0.1:'))return realFetch(input,options);
  if(url.includes('pingzhongdata'))return {ok:true,text:async()=>'var fS_name = "模拟纳斯达克100指数基金";'};
  let result;
  if(url.includes('lsjz')){
   const rows=navDays.filter(d=>d<=published).reverse().map(d=>({FSRQ:d,DWJZ:String(values[days.indexOf(d)]/100),LJJZ:String(values[days.indexOf(d)]/100),JZZZL:d==='2026-10-20'?'4':'0.96'}));
   result={TotalCount:rows.length,Data:{LSJZList:rows}};
  }else if(url.includes('usfqkline'))result={data:{usNDX:{qt:{usNDX:['','','.NDX']},day:days.map((d,i)=>[d,'100',String(values[i])])}}};
  else if(url.includes('stock/kline'))result={data:null};
  else if(url.includes('frankfurter'))result={rates:Object.fromEntries(days.map(d=>[d,{USD:1/7}]))};
  else throw Error('Unexpected fixture URL '+url);
  return {ok:true,text:async()=>JSON.stringify(result),json:async()=>result};
 };
 const refresh=async()=>{const response=await realFetch(origin+'/api/recalculate',{method:'POST',body:JSON.stringify({date:'auto'})});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data.items[0];};
 try{
  app=await import('../server.mjs');await app.serverReady;origin='http://127.0.0.1:'+app.server.address().port;
  let v=await refresh();assert.equal(v.date,'2026-10-20');assert.equal(v.navEstimate.from,'2026-10-16');assert.equal(v.navEstimate.partial,true);
  assert.equal(v.plan.notices[0].noValuation,true);assert.equal(v.plan.targetConfirmed,true);assert.equal(v.record.stages[0].date,'2026-10-19');
  clock='2026-10-21T10:00:00+08:00';v=await refresh();
  assert.equal(v.navEstimate.status,'sealed');assert.ok(Math.abs(v.navEstimate.return-.04)<1e-12);
  const sealed=structuredClone(v.record.forecast);
  clock='2026-10-22T10:00:00+08:00';v=await refresh();
  assert.equal(v.date,'2026-10-21');assert.equal(v.navEstimate.provisional,true);assert.equal(v.pendingPublications.length,2);
  published='2026-10-20';v=await refresh();
  assert.equal(v.navEstimate.provisional,false);assert.equal(v.navEstimate.from,'2026-10-20');assert.equal(v.record.sealedAt!==undefined,true);
  assert.deepEqual(v.pendingPublications.map(p=>p.date),['2026-10-21']);
  const settled20=v.recentObservations.find(r=>r.date==='2026-10-20');assert.equal(settled20.actual,.04);
  clock='2026-10-23T10:00:00+08:00';published='2026-10-21';v=await refresh();
  assert.deepEqual(v.pendingPublications.map(p=>p.date),['2026-10-22']);
  await app.shutdown();app=null;
  const restored=loadState(process.env.QDII_DATA_FILE);
  assert.deepEqual(restored.records['123456:2026-10-20'].forecast,sealed);
  assert.equal(restored.records['123456:2026-10-20'].actual.previousDate,'2026-10-16');
  assert.equal(restored.records['123456:2026-10-21'].actual.previousDate,'2026-10-20');
  assert.equal(restored.records['123456:2026-10-20'].stages[0].date,'2026-10-19');
 }finally{
  if(app)await app.shutdown();globalThis.fetch=realFetch;globalThis.Date=RealDate;
  assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('qdii-period-workflow-'));fs.rmSync(dir,{recursive:true,force:true});
 }
});
