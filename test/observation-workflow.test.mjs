import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {loadState} from '../lib/storage-format.mjs';
test('auto API: holiday stage, baseline publication, sealed cumulative comparison, weekend and Monday publication',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-window-workflow-'));
 process.env.PORT='0';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:['123456'],records:{},lastView:{}}));
 const RealDate=Date,realFetch=globalThis.fetch;
 let clock='2026-10-02T06:00:00+08:00',navDay='2026-09-29',server,origin;
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return RealDate.parse(clock);}};
 const days=['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09'];
 const publications=['2026-09-28','2026-09-29','2026-09-30','2026-10-08','2026-10-09'];
 globalThis.fetch=async(input,options)=>{
  const url=String(input);if(url.startsWith('http://127.0.0.1:'))return realFetch(input,options);
  if(url.includes('pingzhongdata'))return {ok:true,text:async()=> 'var fS_name = "测试纳斯达克100指数基金A";'};
  let value;
  if(url.includes('lsjz')){const rows=publications.filter(d=>d<=navDay).reverse().map(d=>({FSRQ:d,DWJZ:String(1+days.indexOf(d)/100),JZZZL:'1'}));value={TotalCount:rows.length,Data:{LSJZList:rows}};}
  else if(url.includes('usfqkline'))value={data:{usNDX:{qt:{usNDX:['','','.NDX']},day:days.map((d,i)=>[d,'100',String(100+i)])}}};
  else if(url.includes('stock/kline'))value={data:null};
  else if(url.includes('chinamoney.com.cn'))value={head:{rep_code:'200'},data:{currency:'USD/CNY'},records:days.map(date=>({date,values:['6.6667']}))};
  else if(url.includes('frankfurter'))value={rates:Object.fromEntries(days.map(d=>[d,{USD:.15}]))};
  else throw Error('Unexpected upstream '+url);
  return {ok:true,json:async()=>value,text:async()=>JSON.stringify(value)};
 };
 const refresh=async()=>{const response=await realFetch(origin+'/api/recalculate',{method:'POST',body:JSON.stringify({date:'auto'})});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.items[0];};
 try{
  ({server}=await import('../server.mjs'));if(!server.listening)await new Promise(r=>server.once('listening',r));
  origin='http://127.0.0.1:'+server.address().port;
  let view=await refresh();
  assert.equal(view.date,'2026-10-08');assert.equal(view.navEstimate.from,'2026-09-30');assert.equal(view.navEstimate.asOf,'2026-10-01');
  assert.equal(view.forecastHistory.find(r=>r.date==='2026-10-08').value,null);assert.equal(view.stats.pairs.find(r=>r.date==='2026-10-08').forecast,null);
  assert.equal(view.navEstimate.partial,true);assert.equal(view.navEstimate.provisional,true);assert.equal(view.record.forecast,undefined);
  assert.ok(Math.abs(view.navEstimate.return-(103/102-1))<1e-10);
  assert.equal(view.recentObservations[0].date,'2026-09-30');assert.equal(view.recentObservations[0].actual,null);
  clock='2026-10-08T20:00:00+08:00';navDay='2026-09-30';view=await refresh();
  assert.equal(view.navEstimate.asOf,'2026-10-07');assert.equal(view.navEstimate.provisional,false);assert.equal(view.navEstimate.partial,true);
  assert.equal(view.recentObservations[0].actual,.01);
  clock='2026-10-09T06:00:00+08:00';view=await refresh();
  const saved=view.record.forecast;
  assert.equal(view.navEstimate.partial,false);assert.equal(view.navEstimate.status,'sealed');assert.ok(view.record.sealedAt);
  assert.ok(Math.abs(view.navEstimate.return-(108/102-1))<1e-10);
  clock='2026-10-09T21:00:00+08:00';navDay='2026-10-08';view=await refresh();
  assert.equal(view.navEstimate.status,'published');assert.deepEqual(view.record.forecast,saved);assert.equal(view.record.actual.previousDate,'2026-09-30');
  clock='2026-10-10T06:00:00+08:00';view=await refresh();
  assert.equal(view.date,'2026-10-09');assert.equal(view.navEstimate.mode,'daily');assert.equal(view.navEstimate.from,'2026-10-08');
  assert.equal(view.recentObservations[0].date,'2026-10-08');assert.equal(view.recentObservations[0].estimate.return,saved.model.return);
  const friday=view.record.forecast;
  clock='2026-10-11T12:00:00+08:00';view=await refresh();assert.equal(view.date,'2026-10-09');assert.deepEqual(view.record.forecast,friday);
  clock='2026-10-12T21:00:00+08:00';navDay='2026-10-09';view=await refresh();assert.equal(view.date,'2026-10-09');assert.equal(view.record.actual.previousDate,'2026-10-08');assert.deepEqual(view.record.forecast,friday);
  const fxList=await (await realFetch(origin+'/api/funds?cached=1&date=auto')).json();
  assert.ok(fxList.fx);assert.equal(fxList.fx.date,'2026-10-09');assert.equal(fxList.fx.dailyReturn,0);assert.equal(fxList.fx.authority,'CFETS');assert.match(fxList.fx.source,/中国外汇交易中心/);
  const restored=loadState(process.env.QDII_DATA_FILE);assert.equal(restored.records['123456:2026-10-08'].partialForecast.asOf,'2026-10-07');assert.deepEqual(restored.records['123456:2026-10-08'].forecast,saved);
 }finally{if(server)await new Promise(r=>server.close(r));globalThis.fetch=realFetch;globalThis.Date=RealDate;assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('qdii-window-workflow-'));fs.rmSync(dir,{recursive:true,force:true});}
});
