import test from 'node:test';import assert from 'node:assert/strict';
import {RefreshInputs} from '../lib/refresh-inputs.mjs';import {FundStatsCache} from '../lib/fund-stats-cache.mjs';import {forecastStats,validateCalibration} from '../lib/forecast-stats.mjs';import {diagnoseFund} from '../lib/model-diagnostics.mjs';import {reliability} from '../public/forecast-details.js';
const record=(date='2026-10-13')=>({forecast:{date,base:{date:'2026-10-12',value:1},model:{method:'market-close-v4',return:.02,coverage:40},holdingsDate:'2026-06-30',calculatedAt:date+'T02:00:00Z'},actual:{date,previousDate:'2026-10-12',dailyReturn:.01},firstForecastAt:date+'T02:00:00Z',firstActualSeenAt:date+'T22:00:00Z'});
test('request-scoped NAV and bond input reuse does not cross refresh boundaries',async()=>{
 const inputs=new RefreshInputs();let nav=0,fit=0;const loadNav=async()=>++nav,loadFit=async()=>++fit;
 assert.deepEqual(await Promise.all([inputs.nav('111111',loadNav),inputs.nav('111111',loadNav)]),[1,1]);
 assert.deepEqual(await Promise.all([inputs.bond('111111','2026-10-13',loadFit),inputs.bond('111111','2026-10-13',loadFit)]),[1,1]);
 await new RefreshInputs().nav('111111',loadNav);assert.equal(nav,2);assert.equal(fit,1);
});
test('fund statistics cache preserves values and invalidates on changed actuals, timestamps, writes and restore',()=>{
 const cache=new FundStatsCache(),rows=[];const records=cache.bind({'111111:2026-10-13':record()});
 const options={historyRows:rows,targetDate:'2026-10-13',validation:false};let a=cache.get('111111',options);assert.equal(cache.get('111111',options),a);assert.deepEqual(a,forecastStats('111111',records,options));assert.equal(a.groups[0].validation,undefined);
 records['111111:2026-10-13'].actual.dailyReturn=.03;let b=cache.get('111111',options);assert.notEqual(a,b);assert.ok(Math.abs(b.groups[0].windows[0].bias+1)<1e-10);
 records['111111:2026-10-13'].firstActualSeenAt='2026-10-13T00:00:00Z';assert.equal(cache.get('111111',options).pairedCount,0);
 records['111111:2026-10-13']=record();assert.equal(cache.get('111111',options).pairedCount,1);
 delete records['111111:2026-10-13'];assert.equal(cache.get('111111',options).pairedCount,0);
 cache.bind({'111111:2026-10-13':record()});assert.equal(cache.get('111111',options).pairedCount,1);
});
test('walk-forward optimization still finds most recent valid evaluations when later forecasts have no earlier known actuals',()=>{
 const samples=Array.from({length:220},(_,i)=>({date:String(i).padStart(4,'0'),error:1,actualSeenAt:i<120?i+.5:1e9,calculatedAt:i<120?i:-1}));
 const result=validateCalibration(samples);assert.equal(result.count,90);assert.equal(result.from,'0030');assert.equal(result.to,'0119');assert.equal(result.correctedMae,0);
});
test('normal bond waiting is informational and diagnostics do not rank tiny samples',()=>{
 assert.equal(reliability({bond:true,modelError:'等待A股收盘确认后生成正式预估，盘中数值仅供参考'}).attention,false);
 const report=diagnoseFund({code:'111111',name:'测试股票基金',records:{'111111:2026-10-13':record()}});assert.equal(report.samples,1);assert.ok(report.constraints.some(s=>s.includes('不足10')));assert.ok(report.constraints.some(s=>s.includes('40.0%')));assert.match(report.next.join(' '),/暂不调整公式/);
});
