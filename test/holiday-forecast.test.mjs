import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateMarket,previousWeekday} from '../lib/model.mjs';
import {forecastIssue,invalidateForecasts} from '../lib/forecast-policy.mjs';
import {estimateMarketIndex} from '../lib/indices.mjs';
import {rowWithPrices,clearProviderCache} from '../lib/provider.mjs';
import {forecastChart} from '../public/forecast-chart.js';

test('Oct 2 collects Oct 1 close despite missing Chinese NAV and FX publication, even below 20% coverage',async()=>{
 const original=globalThis.fetch;
 await clearProviderCache();
 globalThis.fetch=async url=>{
  if(url.includes('eastmoney'))throw new Error('offline');
  if(url.includes('usfqkline'))return {ok:true,text:async()=>JSON.stringify({data:{'usTEST.OQ':{day:[['2026-09-29','1','100'],['2026-09-30','1','110'],['2026-10-01','1','121']]}}})};
  if(url.includes('frankfurter'))return {ok:true,text:async()=>JSON.stringify({rates:{'2026-09-29':{USD:.14},'2026-09-30':{USD:.14}}})};
  throw new Error('unexpected request');
 };
 try{
  assert.equal(previousWeekday(new Date('2026-10-02T02:00:00Z')),'2026-10-01');
  const base={date:'2026-09-29',value:2};
  const row=await rowWithPrices({code:'TEST',secid:'105.TEST',weight:10},base.date,'2026-10-01');
  assert.equal(row.error,undefined);assert.equal(row.fx.target.date,'2026-09-30');
  const rows=[row,{weight:50,currency:'HKD',rmbReturn:null,error:'没有目标日收盘'}];
  const forecast={date:'2026-10-01',base,holdingsDate:'2026-06-30',rows,model:estimateMarket(base,rows)};
  assert.equal(forecastIssue(forecast),null);assert.equal(forecast.model.coverage,10);
  assert.match(forecastIssue({...forecast,holdingsDate:'2025-12-31'}),/超过190天/);
  assert.ok(Math.abs(forecast.model.value-2.042)<1e-10);
  assert.ok(Math.abs(forecast.model.dailyReturn-.01)<1e-10);
  const key='000001:2026-10-01';
  assert.equal(invalidateForecasts({records:{[key]:{forecast}}}),false);
  assert.match(forecastIssue(forecast,'测试债券基金'),/债基/);
 }finally{globalThis.fetch=original;await clearProviderCache();}
});

test('index daily close and cumulative NAV estimate use different bases over holiday',()=>{
 const q={id:'NDX',date:'2026-10-01',previousDate:'2026-09-30',close:121,previousClose:110,dailyReturn:.1,baseDate:'2026-09-29',baseClose:100};
 const fx={base:{date:'2026-09-29'},target:{date:'2026-09-30'},return:0};
 const dailyFx={base:{date:'2026-09-30'},target:{date:'2026-09-30'},return:0};
 const f=estimateMarketIndex(q.date,{date:'2026-09-29',value:2},q,fx,dailyFx);
 assert.equal(forecastIssue(f),null);assert.equal(f.model.value,2.42);
 assert.ok(Math.abs(f.model.dailyReturn-.1)<1e-10);
 assert.match(forecastIssue({...f,indexQuote:{...q,date:'2026-09-30'}}),/收盘/);
 assert.match(forecastIssue({...f,fx:{...fx,target:{date:'2026-09-01'}}}),/汇率/);
});

test('line chart sorts dates, preserves gaps, shows isolated observations and never zeros missing actuals',()=>{
 const html=forecastChart([{date:'2026-10-02',forecast:.02},{date:'2026-09-30',forecast:.01,actual:.005},{date:'2026-10-01',forecast:null}]);
 const path=html.match(/<path d="([^"]+)"[^>]*stroke="#3266c5"/)[1];
 assert.equal((path.match(/M/g)||[]).length,2,'missing middle observation starts a new segment');assert.doesNotMatch(path,/L/,'gap must not be bridged');
 assert.equal((html.match(/<circle /g)||[]).length,3);
 assert.match(forecastChart([]),/尚无/);
});
