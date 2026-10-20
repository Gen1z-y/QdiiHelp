import test from 'node:test';
import assert from 'node:assert/strict';
import {session,quoteDateMatches,marketStatus} from '../lib/calendar.mjs';
import {rowWithPrices,clearProviderCache} from '../lib/provider.mjs';
import {estimateMarket} from '../lib/model.mjs';
import {forecastIssue} from '../lib/forecast-policy.mjs';
import {indexClose,clearIndexCache,estimateMarketIndex} from '../lib/indices.mjs';
import {forecastStats} from '../lib/forecast-stats.mjs';
import {contributionRows,contributionPanel,accuracyPanel} from '../public/forecast-details.js';

test('accuracyPanel surfaces bias headline only with enough samples',()=>{
 const html=accuracyPanel({pairedCount:30,groups:[{method:'market-close-v4',windows:[{limit:30,count:30,mae:0.12,bias:0.05,direction:0.7,from:'a',to:'b'}]}],excluded:{}});
 assert.match(html,/整体偏高/);assert.match(html,/0\.05/);
 const few=accuracyPanel({pairedCount:3,groups:[{method:'market-close-v4',windows:[{limit:30,count:3,mae:0.1,bias:0.05,direction:0.7,from:'a',to:'b'}]}],excluded:{}});
 assert.ok(!/整体偏高/.test(few));
});

test('exchange holidays differ, makeup weekends stay closed, uncovered calendars cannot authorize stale quotes',()=>{
 assert.equal(session('2026-10-01','HK').closed,true);
 assert.equal(session('2026-10-02','HK').closed,false);
 assert.equal(session('2026-10-02','CN').closed,true);
 assert.equal(session('2026-09-20','CN').closed,true);
 assert.equal(quoteDateMatches('2026-09-30','2026-10-07','CN'),true);
 assert.equal(quoteDateMatches('2026-09-29','2026-10-07','CN'),false);
 assert.equal(quoteDateMatches('2026-09-30','2026-10-02','HK'),false);
 assert.equal(session('2027-10-01','CN').known,false);
 assert.equal(quoteDateMatches('2027-09-30','2027-10-01','CN'),false);
 assert.equal(session('2026-10-01','KR').known,false);
 assert.equal(session('2026-09-22','JP').closed,true);
 assert.equal(session('2027-01-18','US').closed,true);
 assert.equal(session('2027-06-18','US').closed,true);
 assert.equal(session('2027-11-26','US').closeHour,13);
 assert.equal(session('2027-03-22','JP').closed,true);
 assert.equal(session('2027-06-10','JP').known,true);
 assert.equal(session('2027-06-10','JP').closed,false);
});

test('US half days use local time and still require a completed candle buffer',()=>{
 assert.equal(marketStatus('2026-11-27','US',new Date('2026-11-27T18:30:00Z')).state,'pending');
 assert.equal(marketStatus('2026-11-27','US',new Date('2026-11-27T19:01:00Z')).state,'complete');
 assert.equal(marketStatus('2026-09-30','US',new Date('2026-09-30T20:30:00Z')).state,'pending');
 assert.equal(marketStatus('2026-09-30','US',new Date('2026-09-30T21:01:00Z')).state,'complete');
});

test('HK holiday carries only confirmed close, retains FX contribution; missing open-day data remains missing',async()=>{
 const original=globalThis.fetch;await clearProviderCache();
 globalThis.fetch=async url=>{
  if(url.includes('eastmoney'))throw Error('offline');
  if(url.includes('fqkline'))return {ok:true,text:async()=>JSON.stringify({data:{hkTEST:{day:[['2026-09-29','1','100'],['2026-09-30','1','110']]}}})};
  if(url.includes('frankfurter'))return {ok:true,text:async()=>JSON.stringify({rates:{'2026-09-29':{HKD:1},'2026-09-30':{HKD:1},'2026-10-01':{HKD:1/1.02},'2026-10-02':{HKD:1/1.02}}})};
  throw Error('unexpected request');
 };
 try{
  const row=await rowWithPrices({code:'TEST',secid:'116.TEST',weight:50},'2026-09-29','2026-10-01',new Date('2026-10-02T02:00:00Z'));
  assert.equal(row.error,undefined);assert.equal(row.marketStatus.state,'closed');
  assert.equal(row.dailyStock.return,0);assert.ok(Math.abs(row.dailyRmbReturn-.02)<1e-10);
  assert.ok(Math.abs(row.rmbReturn-.122)<1e-10);
  const forecast={date:'2026-10-01',base:{date:'2026-09-29',value:1},holdingsDate:'2026-06-30',rows:[row],model:estimateMarket({value:1},[row])};
  assert.equal(forecastIssue(forecast),null);
  assert.match(forecastIssue({...forecast,date:'2026-10-02'}),/收盘/);
  const missing=await rowWithPrices({code:'TEST',secid:'116.TEST',weight:50},'2026-09-29','2026-10-02',new Date('2026-10-03T02:00:00Z'));
  assert.equal(missing.rmbReturn,null);assert.match(missing.error,/缺少应有/);
  const pending=await rowWithPrices({code:'TEST',secid:'116.TEST',weight:50},'2026-09-29','2026-10-02',new Date('2026-10-02T02:00:00Z'));
  assert.equal(pending.marketStatus.state,'pending');assert.match(pending.error,/尚未/);
 }finally{globalThis.fetch=original;await clearProviderCache();}
});

test('US holiday index daily estimate contains FX only and does not repeat last session gain',async()=>{
 const original=globalThis.fetch;await clearIndexCache();
 globalThis.fetch=async()=>({ok:true,json:async()=>({data:{usNDX:{qt:{usNDX:['','','.NDX']},day:[['2026-09-03','1','100'],['2026-09-04','1','110']]}}})});
 try{
  const q=await indexClose('NDX','2026-09-07','2026-09-03');
  assert.equal(q.date,'2026-09-04');assert.equal(q.valuationPreviousClose,110);
  const fx={base:{date:'2026-09-03'},target:{date:'2026-09-07'},return:.02};
  const dailyFx={base:{date:'2026-09-04'},target:{date:'2026-09-07'},return:.01};
  const f=estimateMarketIndex('2026-09-07',{date:'2026-09-03',value:1},q,fx,dailyFx);
  assert.equal(forecastIssue(f),null);assert.ok(Math.abs(f.model.dailyReturn-.01)<1e-10);
  assert.ok(Math.abs(f.model.return-.122)<1e-10);
  await assert.rejects(()=>indexClose('NDX','2026-09-08','2026-09-03'),/缺少应有/);
 }finally{globalThis.fetch=original;await clearIndexCache();}
});

function record(date,forecast=.02,actual=.01,method='market-close-v3'){
 return {forecast:{date,base:{date:'2026-09-28'},model:{return:forecast,dailyReturn:.001,method},calculatedAt:'2026-09-30T01:00:00.000Z'},
 actual:{date,previousDate:'2026-09-28',dailyReturn:actual},firstForecastAt:'2026-09-30T01:00:00.010Z',firstActualSeenAt:'2026-09-30T10:00:00Z'};
}
test('accuracy compares NAV interval, separates versions, rejects missing and post-publication evidence',()=>{
 const records={'123456:2026-09-30':record('2026-09-30'),'123456:2026-09-29':record('2026-09-29',-.02,-.01,'market-close-v2')};
 records['123456:2026-10-01']={forecast:record('2026-10-01').forecast};
 records['123456:2026-10-02']=record('2026-10-02');records['123456:2026-10-02'].actual.previousDate='2026-09-30';
 records['123456:2026-10-03']=record('2026-10-03');delete records['123456:2026-10-03'].firstActualSeenAt;
 records['123456:2026-10-04']=record('2026-10-04');records['123456:2026-10-04'].forecast.calculatedAt='2026-10-05T00:00:00Z';
 const stats=forecastStats('123456',records);
 assert.equal(stats.pairedCount,2);assert.equal(stats.groups.length,2);
 assert.equal(stats.groups[0].windows[0].mae,1);assert.equal(stats.groups[0].windows[0].bias,1);
 assert.equal(stats.groups[1].windows[0].bias,-1);assert.equal(stats.groups[0].windows[0].direction,1);
 assert.deepEqual(stats.excluded,{unpaired:1,interval:1,timestamp:2,invalid:0});
 assert.match(accuracyPanel(stats),/记录还少/);
 assert.equal(forecastStats('999999',records).mae,null);
});

test('accuracy windows take most recent valid samples rather than calendar days',()=>{
 const records={};
 for(let i=1;i<=95;i++){const date=new Date(Date.UTC(2026,0,i)).toISOString().slice(0,10);records['123456:'+date]=record(date,i/100,0);}
 const s=forecastStats('123456',records).groups[0];
 assert.equal(s.count,95);assert.equal(s.windows[0].count,30);assert.equal(s.windows[1].count,90);
 assert.ok(Math.abs(s.windows[0].mae-80.5)<1e-10);
 assert.equal(s.windows[0].direction,0);
});

test('daily and cumulative contributions use different series, sort signs correctly, never zero missing data',()=>{
 const rows=[{name:'上涨',weight:50,dailyRmbReturn:.02,rmbReturn:-.1},{name:'下跌',weight:20,dailyRmbReturn:-.1,rmbReturn:.5},{name:'缺行情',weight:30,dailyRmbReturn:null,rmbReturn:null}];
 const daily=contributionRows(rows),total=contributionRows(rows,'cumulative');
 assert.deepEqual(daily.map(r=>r.name),['上涨','缺行情','下跌']);
 assert.deepEqual(total.map(r=>r.name),['上涨','缺行情','下跌']);
 assert.equal(daily[1].shownContribution,null);assert.equal(daily[0].shownContribution,.01);
 assert.match(contributionPanel(rows),/单日股价涨跌/);assert.match(contributionPanel(rows,'cumulative'),/区间股价涨跌/);
 assert.doesNotMatch(contributionPanel([{name:'<script>',weight:1}]),/<script>/);
});
