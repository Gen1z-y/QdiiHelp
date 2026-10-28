import test from 'node:test';
import assert from 'node:assert/strict';
import {observationPlan,navEstimate,reconcileObservation} from '../lib/nav-observation.mjs';
const plan=s=>observationPlan(new Date(s+'+08:00'));
const f=(date,from,value=.06)=>({date,base:{date:from,value:1},model:{value:1+value,return:value,dailyReturn:.01},calculatedAt:'2026-10-09T01:00:00Z'});
test('weekend holds Friday, and pre-close never claims the Friday session completed',()=>{
 assert.equal(plan('2026-10-10T03:00:00').target,'2026-10-08');
 for(const day of ['10','11','12'])assert.equal(plan('2026-10-'+day+'T12:00:00').target,'2026-10-09');
});
test('National Day stages exclude September 30 and include October 8 evening',()=>{
 assert.deepEqual(plan('2026-10-01T06:00:00'),{target:'2026-09-30',asOf:'2026-09-30',from:'2026-09-29',partial:false,mode:'daily'});
 for(const [day,asOf] of [['02','01'],['03','02'],['04','02'],['05','02'],['06','05'],['07','06'],['08','07']]){
  const p=plan('2026-10-'+day+'T12:00:00');assert.equal(p.target,'2026-10-08');assert.equal(p.asOf,'2026-10-'+asOf);assert.equal(p.from,'2026-09-30');assert.equal(p.partial,true);
 }
 assert.deepEqual(plan('2026-10-09T06:00:00'),{target:'2026-10-08',asOf:'2026-10-08',from:'2026-09-30',partial:false,mode:'cumulative'});
 assert.equal(plan('2026-10-10T06:00:00').mode,'daily');
});
test('partial values are separate, completed values seal, publication never overwrites them',()=>{
 const target='2026-10-08',from='2026-09-30';
 const partial=reconcileObservation(null,f('2026-10-07',from,.05),null,'a',{target,asOf:'2026-10-07'});
 assert.equal(partial.forecast,undefined);assert.equal(navEstimate({date:target,record:partial}).return,.05);
 assert.equal(navEstimate({date:target,record:partial}).partial,true);
 const closed=reconcileObservation(partial,f(target,from),null,'b',{target});
 assert.equal(closed.sealedAt,'b');assert.equal(closed.forecast.model.return,.06);
 const forced=reconcileObservation(closed,f(target,from,.8),null,'c',{target});
 assert.equal(forced.forecast.model.return,.06);
 const published=reconcileObservation(forced,f(target,from,.9),{date:target,previousDate:from,dailyReturn:.07},'d',{target});
 assert.equal(published.forecast.model.return,.06);assert.equal(navEstimate({date:target,record:published}).status,'published');
 const afterFact=reconcileObservation(partial,f(target,from),{date:target,previousDate:from,dailyReturn:.07},'d',{target});
 assert.equal(afterFact.forecast,null);assert.equal(navEstimate({date:target,record:afterFact}).return,null);
});
test('stale stage and mismatched baseline cannot replace or masquerade as a valid interval',()=>{
 const target='2026-10-08';
 const prior=reconcileObservation(null,f('2026-10-07','2026-09-30'),null,'a',{target,asOf:'2026-10-07'});
 assert.equal(reconcileObservation(prior,f('2026-10-02','2026-09-30'),null,'b',{target,asOf:'2026-10-02'}),prior);
 assert.equal(navEstimate({date:target,record:{forecast:f(target,'2026-09-29')}}).return,null);
});

test('持仓同步可覆盖尚未公布的封存预估，原预测和普通刷新规则保留',()=>{
 const target='2026-10-23',from='2026-10-22',initial=f(target,from,.02);
 let record=reconcileObservation(null,initial,null,'first',{target});
 assert.equal(record.sealedAt,'first');
 const stages=JSON.stringify(record.stages),next=f(target,from,.04);
 record=reconcileObservation(record,next,null,'revised',{target,reviseHoldings:true});
 assert.equal(record.forecast.model.return,.04);assert.equal(record.originalForecast.model.return,.02);
 assert.equal(record.firstForecastAt,'first');assert.equal(record.sealedAt,'revised');
 assert.equal(record.forecastRevisionReason,'holdings-change');assert.equal(record.forecastRevisedAt,'revised');
 assert.equal(JSON.stringify(record.stages),stages);
 const again=reconcileObservation(record,f(target,from,.99),null,'ordinary',{target});
 assert.equal(again.forecast.model.return,.04);
 const published=reconcileObservation(again,f(target,from,.99),{date:target,previousDate:from,value:1.03,dailyReturn:.03},'publication',{target,reviseHoldings:true});
 assert.equal(published.forecast.model.return,.04);assert.equal(published.actual.value,1.03);
 const late=reconcileObservation(published,next,null,'source-regression',{target,reviseHoldings:true});
 assert.equal(late.forecast.model.return,.04);assert.equal(late.actual.value,1.03);
 for(const bad of [null,{...next,model:{return:.99,value:null}},{...next,referenceOnly:true},{...next,base:{date:from,value:1,provisional:true}},{...next,base:{date:'2026-10-21',value:1}}]){
  assert.equal(reconcileObservation(record,bad,null,'invalid',{target,reviseHoldings:true}).forecast.model.return,.04);
 }
 assert.equal(reconcileObservation(record,f('2026-10-22',from,.99),null,'partial',{target,asOf:'2026-10-22',reviseHoldings:true}).forecast.model.return,.04);
});
