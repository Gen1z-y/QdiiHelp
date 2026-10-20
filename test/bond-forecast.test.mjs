import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {bondFitForecast,BOND_MODEL} from '../lib/bond-forecast.mjs';
import {forecastIssue} from '../lib/forecast-policy.mjs';
import {replayForecast} from '../lib/replay-audit.mjs';
import {loadState} from '../lib/storage-format.mjs';

const goodFactors=()=>[
 {symbol:'000012',name:'上证国债指数',date:'2026-10-13',dayReturn:0.001,carried:false},
 {symbol:'000013',name:'上证企债指数',date:'2026-10-13',dayReturn:0.0012,carried:false},
 {symbol:'000832',name:'中证转债指数',date:'2026-10-13',dayReturn:0.005,carried:false}];
const goodRef=()=>({return:0.002,r2:0.9,samples:80,indexDate:'2026-10-13',carried:false,coeffs:[0,2,0,0],factors:goodFactors()});
const base={date:'2026-10-12',value:1.05};

test('盘中、休市、基准与指数异常时都不生成债基正式预估',async()=>{
 const intraday=await bondFitForecast('2026-10-13',{base,reference:async()=>goodRef(),now:new Date('2026-10-13T14:00:00+08:00')});
 assert.equal(intraday.candidate,null);assert.match(intraday.unavailable,/盘中数值仅供参考/);
 const weekend=await bondFitForecast('2026-10-10',{base,reference:async()=>goodRef(),now:new Date('2026-10-10T16:30:00+08:00')});
 assert.equal(weekend.candidate,null);assert.match(weekend.unavailable,/国内休市/);
 const multiDay=await bondFitForecast('2026-10-13',{base:{date:'2026-10-09',value:1.05},reference:async()=>goodRef(),now:new Date('2026-10-13T16:30:00+08:00')});
 assert.equal(multiDay.candidate,null);assert.match(multiDay.unavailable,/跨多日/);
 const provisional=await bondFitForecast('2026-10-13',{base:{date:'2026-10-12',value:1.05,provisional:true},reference:async()=>goodRef(),now:new Date('2026-10-13T16:30:00+08:00')});
 assert.equal(provisional.candidate,null);assert.match(provisional.unavailable,/正式净值基准/);
 const carried=await bondFitForecast('2026-10-13',{base,reference:async()=>({...goodRef(),carried:true,indexDate:'2026-10-12'}),now:new Date('2026-10-13T16:30:00+08:00')});
 assert.equal(carried.candidate,null);assert.match(carried.unavailable,/国债指数收盘行情/);
 const unfit=await bondFitForecast('2026-10-13',{base,reference:async()=>({return:null,unavailable:'拟合样本不足（3/60）',samples:3}),now:new Date('2026-10-13T16:30:00+08:00')});
 assert.equal(unfit.candidate,null);assert.match(unfit.unavailable,/样本不足/);
});

test('收盘确认后生成可校验、可回放的 bond-fit-v1 候选',async()=>{
 const {candidate}=await bondFitForecast('2026-10-13',{base,reference:async()=>goodRef(),now:new Date('2026-10-13T16:30:00+08:00')});
 assert.equal(candidate.model.method,BOND_MODEL);
 assert.ok(Math.abs(candidate.model.return-0.002)<1e-12);
 assert.equal(candidate.model.dailyReturn,candidate.model.return);
 assert.ok(Math.abs(candidate.model.value-1.05*1.002)<1e-12);
 assert.deepEqual(candidate.base,{date:'2026-10-12',value:1.05});
 assert.equal(candidate.fit.factors.length,3);
 assert.equal(candidate.fit.factors[0].date,'2026-10-13');
 assert.equal(forecastIssue(candidate,'测试增强债券基金A'),null);
 const replayed=replayForecast(candidate);
 assert.ok(Math.abs(replayed.return-candidate.model.return)<1e-12);
 assert.ok(Math.abs(replayed.value-candidate.model.value)<1e-12);
});

test('forecastIssue 拒绝被篡改或未收盘生成的债基预估',()=>{
 const valid=()=>({date:'2026-10-13',base:{date:'2026-10-12',value:1.05},model:{return:0.002,dailyReturn:0.002,value:1.05*1.002,method:'bond-fit-v1'},fit:{coeffs:[0,2,0,0],factors:goodFactors(),samples:80,r2:0.9},calculatedAt:'2026-10-13T16:30:00+08:00'});
 assert.equal(forecastIssue(valid()),null);
 const ret=valid();ret.model.return=0.003;assert.match(forecastIssue(ret),/债基拟合预估无效/);
 const early=valid();early.calculatedAt='2026-10-13T14:00:00+08:00';assert.match(forecastIssue(early),/收盘确认/);
 const weak=valid();weak.fit.r2=0.1;assert.match(forecastIssue(weak),/拟合输入不完整/);
 const few=valid();few.fit.samples=30;assert.match(forecastIssue(few),/拟合输入不完整/);
 const stale=valid();stale.fit.factors[0].date='2026-10-12';assert.match(forecastIssue(stale),/拟合输入不完整/);
 const span=valid();span.base.date='2026-10-09';assert.match(forecastIssue(span),/前一交易日基准/);
 const holiday=valid();holiday.date='2026-10-07';assert.match(forecastIssue(holiday),/国内休市/);
});

test('债基当天预估当天：盘中仅参考，收盘封存，公布后计入独立准确性统计',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-bond-forecast-'));
 process.env.PORT='8817';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:['123456'],records:{},lastView:{}}));
 const RealDate=Date,realFetch=globalThis.fetch;
 let clock='2026-10-13T10:00:00+08:00',navDay='2026-10-12',server;
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return RealDate.parse(clock);}};
 const cnHolidays=new Set(['2026-05-01','2026-05-04','2026-05-05','2026-06-19','2026-09-25','2026-10-01','2026-10-02','2026-10-05','2026-10-06','2026-10-07']);
 const dates=[];
 for(let d=new RealDate('2026-05-04T12:00:00Z');d<=new RealDate('2026-10-13T12:00:00Z');d.setUTCDate(d.getUTCDate()+1)){
  const s=d.toISOString().slice(0,10);
  if(![0,6].includes(d.getUTCDay())&&!cnHolidays.has(s))dates.push(s);
 }
 const idxReturn=i=>i===0?0:i%2?-0.0005:0.001;
 const j=dates.indexOf('2026-10-13'),expected=2*idxReturn(j),baseValue=1+(j-1)*0.001;
 globalThis.fetch=async(input,options)=>{
  const url=String(input);if(url.startsWith('http://127.0.0.1:'))return realFetch(input,options);
  if(url.includes('pingzhongdata'))return {ok:true,text:async()=> 'var fS_name = "测试增强债券基金A";'};
  let value;
  if(url.includes('lsjz')){
   const u=new URL(url),page=Number(u.searchParams.get('pageIndex')),size=Number(u.searchParams.get('pageSize'));
   const pub=dates.filter(d=>d<=navDay).map(d=>{const i=dates.indexOf(d);return {FSRQ:d,DWJZ:String(1+i*0.001),JZZZL:d==='2026-10-13'&&navDay==='2026-10-13'?'0.25':i===0?'0':i%2?'-0.1':'0.2'};}).reverse();
   value={TotalCount:pub.length,Data:{LSJZList:pub.slice((page-1)*size,page*size)}};
  }
  else if(url.includes('ifzq.gtimg.cn')){
   const sym=(url.match(/param=sh(\d{6})/)||[])[1];
   const fn={'000012':idxReturn,'000013':i=>idxReturn(i)+(i%3?0.0002:-0.0003),'000832':i=>idxReturn(i)+[0.004,-0.003,0.002,-0.002,0.001][i%5]}[sym];
   let close=100;
   value={code:0,msg:'',data:{['sh'+sym]:{day:dates.map((d,i)=>{close*=1+(i===0?0:fn(i));const c=String(close);return [d,c,c,c,c,'1'];})}}};
  }
  else if(url.includes('stock/kline'))value={data:null};
  else throw Error('Unexpected upstream '+url);
  return {ok:true,json:async()=>value,text:async()=>JSON.stringify(value)};
 };
 const get=async u=>{const r=await realFetch('http://127.0.0.1:8817'+u);const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b;};
 try{
  ({server}=await import('../server.mjs'));if(!server.listening)await new Promise(r=>server.once('listening',r));
  // 盘中：只有拟合参考，不生成正式预估。
  let body=await get('/api/funds?date=auto');
  let view=body.items[0];
  assert.equal(view.date,'2026-10-13');
  assert.ok(!view.record?.forecast);assert.equal(view.navEstimate.return,null);
  assert.match(view.modelError,/等待A股收盘确认/);
  assert.match(view.bondReference?.unavailable??'',/样本不足/);
  while((await get('/api/history-sync')).running)await new Promise(r=>setTimeout(r,20));
  clock='2026-10-13T10:10:00+08:00';
  view=(await get('/api/funds?date=auto')).items[0];
  assert.ok(Number.isFinite(view.bondReference.return),'intraday index bar feeds the display reference');
  assert.ok(Math.abs(view.bondReference.return-expected)<1e-9);
  assert.ok(!view.record?.forecast);assert.equal(view.navEstimate.return,null);
  // 收盘确认后：生成正式预估并封存，预估净值 = 基准 × (1+拟合变动)。
  clock='2026-10-13T16:30:00+08:00';
  const recalc=await realFetch('http://127.0.0.1:8817/api/recalculate',{method:'POST',body:JSON.stringify({date:'auto'})});
  view=(await recalc.json()).items[0];
  assert.equal(view.record.forecast.model.method,BOND_MODEL);
  assert.ok(view.record.sealedAt,'sealed before publication');
  assert.equal(view.navEstimate.status,'sealed');
  assert.ok(Math.abs(view.navEstimate.return-expected)<1e-9);
  assert.ok(Math.abs(view.navEstimate.value-baseValue*(1+expected))<1e-9);
  assert.equal(view.record.forecast.base.date,'2026-10-12');
  const saved=view.record.forecast;
  assert.equal(forecastIssue(saved,view.name),null);
  // 当晚公布：封存值保留，样本计入 bond-fit-v1 独立分组。
  clock='2026-10-13T20:00:00+08:00';navDay='2026-10-13';
  view=(await get('/api/funds?date=auto')).items[0];
  assert.equal(view.navEstimate.status,'published');
  assert.deepEqual(view.record.forecast,saved);
  assert.ok(Math.abs(view.record.actual.dailyReturn-0.0025)<1e-12);
  assert.equal(view.record.actual.previousDate,'2026-10-12');
  assert.equal(view.stats.pairedCount,1);
  const group=view.stats.groups.find(g=>g.method===BOND_MODEL);
  assert.ok(group,'bond method forms its own accuracy group');
  assert.equal(group.windows[0].count,1);
  assert.ok(Math.abs(group.windows[0].mae-Math.abs(expected-0.0025)*100)<1e-6);
  const restored=loadState(process.env.QDII_DATA_FILE);
  assert.equal(restored.records['123456:2026-10-13'].forecast.model.method,BOND_MODEL);
  assert.ok(restored.records['123456:2026-10-13'].sealedAt);
 }finally{if(server)await new Promise(r=>server.close(r));globalThis.fetch=realFetch;globalThis.Date=RealDate;assert.ok(path.basename(dir).startsWith('qdii-bond-forecast-'));fs.rmSync(dir,{recursive:true,force:true});}
});
