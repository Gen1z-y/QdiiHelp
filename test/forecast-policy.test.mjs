import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastIssue,invalidateForecasts} from '../lib/forecast-policy.mjs';
const valid=()=>({date:'2026-09-29',holdingsDate:'2026-06-30',base:{date:'2026-09-28'},model:{return:.01,value:1.01},rows:[{currency:'USD',rmbReturn:.01,stock:{base:{date:'2026-09-28'},target:{date:'2026-09-29'}},fx:{base:{date:'2026-09-28'},target:{date:'2026-09-29'}}}]});

test('holiday carry cannot produce zero daily income while overseas holdings await close',()=>{
 const f={date:'2026-10-07',calculatedAt:'2026-10-07T04:46:00Z',holdingsDate:'2026-06-30',base:{date:'2026-09-29',value:1},model:{method:'market-close-v4',return:.01,dailyReturn:0,dailyProfitReturn:0,value:1.01},rows:[
  {weight:17,secid:'0.300408',currency:'CNY',rmbReturn:.01,dailyRmbReturn:0,stock:{base:{date:'2026-09-29'},target:{date:'2026-09-30'}},dailyBaseDate:'2026-10-06',dailyStock:{base:{date:'2026-09-30'},target:{date:'2026-09-30'}}},
  {weight:6,secid:'105.MU',rmbReturn:null,marketStatus:{state:'pending'}}
 ]};
 assert.match(forecastIssue(f),/等待持仓市场收盘/);
 delete f.rows[1].marketStatus;
 assert.match(forecastIssue(f),/等待持仓市场收盘/);
 const key='270023:2026-10-07',data={records:{[key]:{forecast:f}},lastView:{},incomeRecords:{[key]:{estimated:0,actual:null,profit:0}}};
 invalidateForecasts(data);
 assert.equal(data.records[key].forecast,null);assert.equal(data.incomeRecords[key],undefined);
 assert.equal(data.rejectedIncomeRecords.length,1);
});
test('aligned previous-day close forecast remains usable',()=>assert.equal(forecastIssue(valid()),null));
test('actively managed Nasdaq stock selection fund is not mistaken for an index fund',()=>assert.equal(forecastIssue(valid(),'华宝纳斯达克精选股票发起式(QDII)A'),null));
test('reject mixed market dates, stale FX and multi-day bases',()=>{
 const mixed=valid();mixed.rows.push({...mixed.rows[0],stock:{base:{date:'2026-09-28'},target:{date:'2026-09-28'}}});assert.match(forecastIssue(mixed),/收盘/);
 const fx=valid();fx.rows[0].fx.target.date='2026-09-28';assert.match(forecastIssue(fx),/汇率/);
 const span=valid();span.base.date='2026-09-25';assert.match(forecastIssue(span),/单日/);
});
test('reject old holdings and ETF feeder use of stock model',()=>{
 const old=valid();old.holdingsDate='2023-08-31';assert.match(forecastIssue(old),/190天/);
 assert.match(forecastIssue(valid(),'大成纳斯达克100ETF联接(QDII)A'),/暂停/);
});
test('migration archives invalid forecasts and income, preserves actuals and positions, is repeatable',()=>{
 const f=valid();f.date='2026-09-30';const key='270023:2026-09-30';
 const data={positions:{'270023':{amount:7500,profit:100}},records:{[key]:{forecast:f,actual:{dailyReturn:.02}}},lastView:{[key]:{code:'270023',name:'全球基金',analysis:f}},incomeRecords:{[key]:{estimated:62.52,actual:null,profit:62.52}}};
 assert.equal(invalidateForecasts(data),true);assert.equal(data.records[key].forecast,null);assert.equal(data.records[key].actual.dailyReturn,.02);assert.equal(data.records[key].rejectedForecasts.length,1);assert.equal(data.incomeRecords[key],undefined);assert.equal(data.rejectedIncomeRecords[0].profit,62.52);assert.equal(data.positions['270023'].amount,7500);assert.equal(invalidateForecasts(data),false);
});
