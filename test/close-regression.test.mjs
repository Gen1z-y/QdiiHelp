import test from 'node:test';
import assert from 'node:assert/strict';
import {completedBars,rowWithPrices} from '../lib/provider.mjs';
import {indexClose,estimateIndex} from '../lib/indices.mjs';
import {forecastIssue} from '../lib/forecast-policy.mjs';
import {estimate,previousWeekday} from '../lib/model.mjs';

test('Oct 1 Beijing morning uses Sep 30 US session; winter and live candles are filtered',()=>{
 const rows=[{date:'2026-09-29',close:100},{date:'2026-09-30',close:102}];
 const market=['美国','USD','America/New_York',16];
 assert.equal(previousWeekday(new Date('2026-10-01T02:00:00Z')),'2026-09-30');
 assert.equal(completedBars(rows,market,new Date('2026-10-01T02:00:00Z')).at(-1).date,'2026-09-30');
 assert.equal(completedBars(rows,market,new Date('2026-09-30T19:00:00Z')).at(-1).date,'2026-09-29');
 assert.equal(completedBars([{date:'2026-12-01',close:1}],market,new Date('2026-12-01T21:30:00Z')).length,0);
});

test('latest Tencent series is requested, dates are filtered, missing FX preserves stock detail',async()=>{
 const original=globalThis.fetch,urls=[];
 globalThis.fetch=async url=>{
  urls.push(url);
  if(url.includes('eastmoney'))throw new Error('offline');
  if(url.includes('usfqkline'))return {ok:true,text:async()=>JSON.stringify({data:{'usTEST.OQ':{qfqday:[['2026-09-29','1','100'],['2026-09-30','1','102'],['2026-10-01','1','999']]},usNDX:{qt:{usNDX:['','','.NDX']},day:[['2026-09-29','1','100'],['2026-09-30','1','102']]}}}),json:async()=>({data:{usNDX:{qt:{usNDX:['','','.NDX']},day:[['2026-09-29','1','100'],['2026-09-30','1','102']]}}})};
  throw new Error('FX offline');
 };
 try{
  const row=await rowWithPrices({code:'TEST',secid:'105.TEST',weight:10},'2026-09-29','2026-09-30');
  assert.equal(row.stock.target.date,'2026-09-30');assert.ok(Math.abs(row.stock.return-.02)<1e-10);assert.equal(row.rmbReturn,null);assert.match(row.error,/FX/);
  const quote=await indexClose('NDX','2026-09-30');assert.equal(quote.date,'2026-09-30');
  assert.ok(urls.filter(u=>u.includes('usfqkline')).every(u=>u.includes(',day,,,96,qfq')));
 }finally{globalThis.fetch=original;}
});

test('单日变动超阈值的行情被判异常并排除',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>{
  if(url.includes('eastmoney'))return {ok:true,text:async()=>JSON.stringify({data:{klines:['2026-09-29,1,100,1,1,1,1,1,0','2026-09-30,1,250,1,1,1,1,1,150','2026-10-01,1,260,1,1,1,1,1,4']}})};
  if(url.includes('usfqkline'))return {ok:true,text:async()=>JSON.stringify({data:{'usTEST.OQ':{qfqday:[['2026-09-29','1','100'],['2026-09-30','1','250'],['2026-10-01','1','260']]}}})};
  throw new Error('FX offline');
 };
 try{
  const row=await rowWithPrices({code:'TEST',secid:'105.TEST',weight:10},'2026-09-29','2026-10-01');
  assert.equal(row.rmbReturn,null);
  assert.match(row.error,/行情单日变动异常/);
 }finally{globalThis.fetch=original;}
});

test('incomplete row cannot invalidate valid covered holdings or contribute stale zero',()=>{
 const row={weight:30,currency:'CNY',stock:{base:{date:'2026-09-29'},target:{date:'2026-09-30'}},rmbReturn:.02};
 const rows=[row,{weight:10,rmbReturn:null,error:'未收盘'}],base={date:'2026-09-29',value:1};
 const f={date:'2026-09-30',base,holdingsDate:'2026-06-30',rows,model:estimate(base,rows)};
 assert.equal(forecastIssue(f),null);assert.equal(f.model.coverage,30);assert.equal(f.model.return,.006);
});

test('index proxy combines matching FX and local session, rejects stale or mismatched reference',()=>{
 const quote={id:'NDX',date:'2026-09-30',previousDate:'2026-09-29',dailyReturn:.02};
 const fx={base:{date:'2026-09-29'},target:{date:'2026-09-30'},return:.001};
 const f=estimateIndex('2026-09-30',{date:'2026-09-29',value:2},quote,fx);
 assert.equal(forecastIssue(f,'纳指100ETF联接'),null);assert.ok(Math.abs(f.model.return-.02102)<1e-10);
 assert.match(forecastIssue({...f,indexQuote:{...quote,date:'2026-09-29'}}),/日期/);
 assert.match(forecastIssue({...f,fx:{...fx,target:{date:'2026-09-29'}}}),/汇率/);
});
