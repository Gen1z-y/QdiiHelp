import test from 'node:test';
import assert from 'node:assert/strict';
import {fitBondRidge} from '../lib/bond-adaptive.mjs';
import {STABLE_CONFIGS,stableBondFit,stableBondChoice,stableFitIssue,bondErrors,bondReliability,bondPrediction} from '../lib/bond-stability.mjs';
import {ADAPTIVE_BOND_FACTORS} from '../lib/bond-factors.mjs';
import {bondFitForecast} from '../lib/bond-forecast.mjs';
import {forecastIssue} from '../lib/forecast-policy.mjs';
import {replayForecast} from '../lib/replay-audit.mjs';
import {forecastStats} from '../lib/forecast-stats.mjs';
import {bondErrorPanel} from '../public/forecast-details.js';
import {expectedCloseDate,shiftDate} from '../lib/calendar.mjs';

const target='2026-10-22',base={date:'2026-10-21',value:1.2},now=new Date(target+'T19:00:00+08:00');
const disclosure={schema:1,asOf:'2026-06-30',publishedAt:'2026-07-21',stockWeight:0,
 categories:{government:20,financial:60,policy:20,corporate:2,commercialPaper:2,mtn:20,convertible:0,cd:2,other:0,total:106}};
function rows(){return Array.from({length:160},(_,i)=>{
 const x=Array.from({length:8},(_,j)=>.0001+Math.sin(i*(j+1)*.37)*.0006+Math.cos(i*(j+2)*.23)*.0002);
 return {date:String(i),x,y:.00002+x[0]*.4+x[2]*.6};
});}
function evaluations(){
 const dates=[];for(let d=expectedCloseDate(shiftDate(target,-1),'CN');dates.length<30;d=expectedCloseDate(shiftDate(d,-1),'CN'))dates.unshift(d);
 return dates.map(date=>({date,errors:[.00004,.00005,.00006],stableError:.00001}));
}
function reference(){
 const fit=stableBondFit(rows(),disclosure,fitBondRidge),es=evaluations(),stability=stableBondChoice(es);
 const factors=ADAPTIVE_BOND_FACTORS.map((f,i)=>({...f,date:target,previousDate:base.date,carried:false,dayReturn:rows().at(-1).x[i]}));
 const ret=bondPrediction(fit.coeffs,factors.map(f=>f.dayReturn));
 return {...fit,return:ret,method:'bond-fit-v3',factors,indexDate:target,carried:false,disclosure,stability,
  validation:{count:30,from:es[0].date,to:es.at(-1).date,baselineMae:.0002,candidateMae:.00001,baselineWorst:.0003,candidateWorst:.00001,recentBaselineMae:.0002,recentCandidateMae:.00001,unit:'return',reconstructed:true},
  reliability:bondReliability(es.map(e=>e.stableError)),adaptive:{status:'selected'}};
}

test('极端输入保留但降低影响；普通数据及原岭回归配置保持兼容',()=>{
 const clean=rows(),shocked=structuredClone(clean),c={window:160,halfLife:60,ridge:.2};
 shocked.at(-1).x=shocked.at(-1).x.map(x=>x*30);shocked.at(-1).y+=.02;
 const original=fitBondRidge(shocked,disclosure,c),stable=fitBondRidge(shocked,disclosure,{...c,leverageCap:3});
 assert.equal(stable.samples,160);assert.deepEqual(shocked.at(-1).x,clean.at(-1).x.map(x=>x*30));
 const truth=fitBondRidge(clean,disclosure,c),x=clean[80].x;
 assert.ok(Math.abs(bondPrediction(stable.coeffs,x)-bondPrediction(truth.coeffs,x))<Math.abs(bondPrediction(original.coeffs,x)-bondPrediction(truth.coeffs,x)));
 assert.ok(stable.coeffs.slice(1).every(x=>x>=0));assert.equal(fitBondRidge(clean.slice(0,59),disclosure,c),null);
 assert.deepEqual(fitBondRidge(clean,disclosure,c).coeffs,fitBondRidge(clean,disclosure,{...c,leverageCap:0}).coeffs);
});

test('稳定候选必须通过独立确认；后10日不能参与选择对照窗口',()=>{
 const es=evaluations(),a=stableBondChoice(es);assert.equal(a.accepted,true);assert.equal(a.incumbentIndex,0);
 const worse=structuredClone(es);worse.slice(20).forEach(e=>{e.errors[1]=0;e.stableError=.0002;});
 const b=stableBondChoice(worse);assert.equal(b.incumbentIndex,0);assert.equal(b.accepted,false);
 assert.equal(stableBondChoice(es.slice(1)),null);assert.equal(stableBondChoice(es.map((e,i)=>i?e:{...e,stableError:null})),null);
});

test('稳定组合封存、审计和独立准确性统计；拒绝成员或确认窗口篡改',async()=>{
 const ref=reference();assert.equal(stableFitIssue({...ref}),null);
 assert.deepEqual(ref.members.map(m=>m.config),STABLE_CONFIGS);
 const {candidate}=await bondFitForecast(target,{base,now,reference:async()=>ref});
 assert.ok(candidate);assert.equal(forecastIssue(candidate),null);assert.equal(replayForecast(candidate).return,candidate.model.return);
 for(const mutate of [f=>{f.fit.members[0].coeffs[1]+=.01;},f=>{f.fit.stability.accepted=false;},f=>{f.fit.stability.confirmation.from=f.fit.stability.selection.to;},f=>{delete f.fit.reliability;},f=>{f.fit.validation.candidateMae=1;}]){
  const changed=structuredClone(candidate);mutate(changed);assert.ok(forecastIssue(changed));
 }
 const prev={...structuredClone(candidate),date:base.date,base:{date:'2026-10-20',value:1},model:{...candidate.model,method:'bond-fit-v2'}};
 const records={['888888:'+target]:{forecast:candidate,firstForecastAt:now.toISOString(),actual:{date:target,previousDate:base.date,dailyReturn:0},firstActualSeenAt:target+'T20:00:00+08:00'},
  ['888888:'+base.date]:{forecast:prev,firstForecastAt:base.date+'T19:00:00+08:00',actual:{date:base.date,previousDate:'2026-10-20',dailyReturn:0},firstActualSeenAt:base.date+'T20:00:00+08:00'}};
 prev.calculatedAt=base.date+'T19:00:00+08:00';
 assert.deepEqual(forecastStats('888888',records).groups.map(g=>[g.method,g.count]),[['bond-fit-v3',1],['bond-fit-v2',1]]);
});

test('绝对误差门槛仅作参考而不封存；零误差有效，范围不是概率保证',async()=>{
 assert.equal(bondReliability(Array(30).fill(0)).halfWidth,0);
 assert.equal(bondReliability(Array(30).fill(.0003)).level,'reference');
 for(const es of [Array(30).fill(.00031),[.00101,...Array(29).fill(0)]]){
  const reliability=bondReliability(es);assert.equal(reliability.level,'low');
  const ref={...reference(),reliability,adaptive:{status:'unreliable',reason:'历史误差较大'}};
  const result=await bondFitForecast(target,{base,now,reference:async()=>ref});assert.equal(result.candidate,null);assert.match(result.unavailable,/误差较大/);
  const forced=await bondFitForecast(target,{base,now,reference:async()=>({...ref,adaptive:{status:'selected'}})});
  assert.match(forecastIssue(forced.candidate),/历史误差过大/);
 }
 const r=bondReliability(Array(30).fill(.0001),[-.001,.001]);assert.equal(r.halfWidth,.001);assert.equal(r.level,'low');
 const html=bondErrorPanel({reliability:r,stability:{accepted:true}},0);assert.match(html,/参考性弱/);assert.match(html,/-0.1000% ～ \+0.1000%/);assert.match(html,/不保证/);assert.match(html,/后10日独立确认/);
 assert.equal(bondErrorPanel({reliability:{...r,halfWidth:NaN}},0),'');assert.equal(bondErrorPanel({},0),'');
 assert.equal(bondErrors([0,.001]).p90,.001);
});
