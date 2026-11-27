
import test from 'node:test';
import assert from 'node:assert/strict';
import {bondFitForecast} from '../lib/bond-forecast.mjs';
import * as intraday from '../lib/bond-intraday.mjs';
const {bondComparisonStats,blendBondReference}=intraday;
import {previousNavDate} from '../lib/nav-observation.mjs';
import {forecastIssue} from '../lib/forecast-policy.mjs';
import {replayForecast} from '../lib/replay-audit.mjs';

const target='2026-11-27';
const base={date:previousNavDate(target),value:1.1};
const close=new Date(target+'T16:30:00+08:00');
const holdings={disclosures:[{schema:1,asOf:'2026-09-30',publishedAt:'2026-10-27',stockWeight:0,categories:{convertible:0,total:107}}]};
const lowFit=async()=>({return:null,samples:160,r2:.205,unavailable:'拟合质量不足'});
const input={name:'测试中短债A',base,holdings,now:close,reference:lowFit};

function history(returns){
 const rows=[];
 for(let i=0,date=base.date;i<76;i++,date=previousNavDate(date)){
  rows.push({date,dailyReturn:returns[i%returns.length],value:1.1});
 }
 return {rows};
}

test('短债低拟合以通过逐日验证的历史净值模型封存，模型可重放',async()=>{
 const source=history([.0002,.0003,.0002,.0001,.0002]);
 source.rows.unshift({date:target,dailyReturn:.4,value:1.5});
 const result=await bondFitForecast(target,{...input,history:source});
 const f=result.candidate;
 assert.equal(f?.model?.method,'bond-nav-median-v1');
 assert.equal(f.model.return,.0002);
 assert.equal(f.fit.navMedian.validation.count,60);
 assert.equal(f.fit.navMedian.validation.to,base.date);
 assert.equal(forecastIssue(f,input.name),null);
 assert.equal(replayForecast(f).return,.0002);
 f.model.return=.0003;
 assert.match(forecastIssue(f,input.name),/净值.*预估无效/);
});

test('净值备用模型拒绝盘中、持仓不符、回放无改善和最新基准缺失',async()=>{
 const useful=history([.0002]);
 for(const opts of [
  {...input,history:useful,now:new Date(target+'T10:30:00+08:00')},
  {...input,history:useful,name:'测试中长纯债A'},
  {...input,history:useful,holdings:null},
  {...input,history:useful,reference:async()=>null},
  {...input,history:history([.0003,-.0003])},
  {...input,history:{rows:useful.rows.slice(1)}},
 ])assert.equal((await bondFitForecast(target,opts)).candidate,null);
});

test('盘中综合参考只在同一时段公布前的历史配对优于两种单独参考时采用',()=>{
 const records={};
 for(let date=base.date,i=0;i<6;i++,date=previousNavDate(date)){
  records['007329:'+date]={
   bondComparisons:{afternoon:{date,time:'13:45',at:date+'T13:47:00+08:00',curve:.0007,baseline:-.0003,paired:true}},
   actual:{date,previousDate:previousNavDate(date),dailyReturn:.0002},
   firstActualSeenAt:date+'T20:00:00+08:00',
  };
 }
 const curve={method:'bond-curve-v1',date:target,time:'13:45',baseDate:base.date,return:.0007};
 const ref={indexDate:target,return:-.0003};
 const comparison=bondComparisonStats(records,target);
 const blended=blendBondReference(curve,ref,comparison);
 assert.ok(Math.abs(blended.return-.0002)<1e-10);
 assert.equal(blended.validation.pairs,6);
 assert.equal(blendBondReference({...curve,time:'10:00'},ref,comparison),null);
 assert.equal(blendBondReference(curve,{...ref,indexDate:base.date},comparison),null);
 records['007329:'+base.date].firstActualSeenAt=base.date+'T13:30:00+08:00';
 assert.equal(blendBondReference(curve,ref,bondComparisonStats(records,target)),null);
});
