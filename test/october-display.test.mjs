import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastIssue,invalidateForecasts} from '../lib/forecast-policy.mjs';
import {forecastChart} from '../public/forecast-chart.js';
import {globalIndex,parseBaiduOverview} from '../lib/global-markets.mjs';

test('weekend carry is rejected and archived without removing actual NAV',()=>{
 const forecast={date:'2026-10-03',model:{dailyReturn:0}};
 assert.match(forecastIssue(forecast),/周末/);
 const actual={date:'2026-10-03',dailyReturn:.01};
 const state={records:{'123456:2026-10-03':{forecast,actual}}};
 assert.equal(invalidateForecasts(state),true);
 assert.equal(state.records['123456:2026-10-03'].forecast,null);
 assert.equal(state.records['123456:2026-10-03'].actual,actual);
 assert.equal(state.records['123456:2026-10-03'].rejectedForecasts.length,1);
});
test('empty and rejected endpoints cannot extend the chart, actual zero is preserved',()=>{
 const chart=forecastChart([{date:'2026-10-02',actual:0},{date:'2026-10-03',rejection:'周末'},{date:'2026-10-04',indexClose:{date:'2026-10-02',dailyReturn:.02}}],true);
 assert.match(chart,/10-02/);assert.doesNotMatch(chart,/10-03|10-04/);
});
const overview={Result:[{TplData:{result:{index_map:[{code:'FTSE',ratio:'+0.32%'}],hot_index:[{index_list:[{code:'DAX',last_px:'25231.20',px_change_rate:'+1.17%'}]}]}}}]};
test('Baidu fallback keeps missing timestamps and points missing, never manufactures bars',()=>{
 const ftse=parseBaiduOverview(overview,{id:'FTSE'});
 assert.equal(ftse.latest.date,null);assert.equal(ftse.latest.close,null);assert.equal(ftse.latest.change,.0032);assert.deepEqual(ftse.rows,[]);
 assert.throws(()=>parseBaiduOverview({}, {id:'FTSE'}));
});
test('failed daily sources fall back to Baidu and cache that quote during outage',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async url=>{if(!url.includes('baidu.com'))throw Error('offline');return {ok:true,json:async()=>overview};};
  const value=await globalIndex('DAX',true);assert.equal(value.latest.close,25231.2);assert.equal(value.latest.date,null);assert.equal(value.stale,false);
  globalThis.fetch=async()=>{throw Error('offline');};
  const cached=await globalIndex('DAX',true);assert.equal(cached.stale,true);assert.equal(cached.latest.close,25231.2);
 }finally{globalThis.fetch=original;}
});
