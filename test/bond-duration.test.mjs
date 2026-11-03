import test from 'node:test';
import assert from 'node:assert/strict';
import {durationHint,validDurationHint,durationDisclosures,durationChoice,durationFitIssue} from '../lib/bond-duration.mjs';
import {mergeBondHolding} from '../lib/bond-disclosure.mjs';
import {adaptiveBondReference} from '../lib/bond-adaptive.mjs';
import {ADAPTIVE_BOND_FACTORS} from '../lib/bond-factors.mjs';
import {bondFitForecast} from '../lib/bond-forecast.mjs';
import {forecastIssue} from '../lib/forecast-policy.mjs';
import {replayForecast} from '../lib/replay-audit.mjs';
import {forecastStats} from '../lib/forecast-stats.mjs';
import {expectedCloseDate,shiftDate} from '../lib/calendar.mjs';

const d={schema:1,asOf:'2026-06-30',publishedAt:'2026-07-21',stockWeight:0,
 categories:{government:60,financial:40,policy:0,corporate:0,commercialPaper:0,mtn:0,convertible:0,cd:0,other:0,total:100}};
const holding=()=>({asOf:d.asOf,rows:[{code:'2600002',name:'26超长特别国债02',weight:60},{code:'260205',name:'26国开05',weight:5}],disclosures:[structuredClone(d)]});
test('仅将同报告期明确超长特别国债的披露占比作为软先验，不放大前五大',()=>{
 const h=holding(),hint=durationHint(h);assert.equal(hint.governmentWeight,60);assert.equal(hint.rows.length,1);assert.equal(validDurationHint(hint,d),true);
 assert.equal(validDurationHint({...hint,governmentWeight:61},d),false);assert.equal(validDurationHint(hint,{...d,asOf:'2026-09-30'}),false);
 assert.equal(validDurationHint(hint,{...d,categories:{government:59}}),false);
 assert.equal(durationHint({...h,rows:[h.rows[0],h.rows[0]]}),null);
 assert.equal(durationHint({...h,rows:[{...h.rows[0],weight:NaN}]}),null);
 assert.equal(durationHint({...h,rows:[{...h.rows[0],name:'超长期金融债'}]}),null);
 assert.equal(durationDisclosures({...h,asOf:'2026-09-30'})[0].durationHint,undefined);
});
test('同步换期保留旧期线索，同期改动撤回旧线索，不修改不可变快照',()=>{
 const old=holding(),hint=durationHint(old);old.durationHints=[hint];Object.freeze(old);Object.freeze(old.durationHints);
 const next=mergeBondHolding(old,{asOf:'2026-09-30',rows:[],disclosures:[]});assert.equal(next.durationHints[0].asOf,d.asOf);
 const removed=mergeBondHolding(old,{...holding(),rows:[{code:'260205',name:'26国开05',weight:5}]});assert.equal(removed.durationHints.length,0);assert.equal(durationDisclosures(removed)[0].durationHint,undefined);
 assert.equal(old.durationHints.length,1);
});
test('必须同时改善平均误差且最大、近期误差不增加；不足30日不切换',()=>{
 const es=Array.from({length:30},(_,i)=>({date:'2026-09-'+String(i+1).padStart(2,'0'),errors:[.0001,.0002,.0003],durationErrors:[.00005,.00006,.00007]}));
 assert.equal(durationChoice(es,0).accepted,true);assert.equal(durationChoice(es.slice(1),0),null);
 const worse=structuredClone(es);worse.at(-1).durationErrors=[.00011,.00012,.00013];assert.equal(durationChoice(worse,0).accepted,false);
 const equal=es.map(e=>({...e,durationErrors:e.errors}));assert.equal(durationChoice(equal,0).accepted,false);
});
function fixture(){
 const target='2026-10-22',dates=[target];for(let i=0;i<180;i++)dates.unshift(expectedCloseDate(shiftDate(dates[0],-1),'CN'));
 const series=Object.fromEntries(ADAPTIVE_BOND_FACTORS.map((f,j)=>[f.symbol,dates.map((date,i)=>({date,previousDate:dates[i-1],dayReturn:.0001+Math.sin(i*(j+1)*.37)*.0006+Math.cos(i*(j+2)*.23)*.0002}))]));
 const rows=dates.map((date,i)=>({date,value:1,dailyReturn:.00002+series['cb:ultra'][i].dayReturn*.6+series['cb:bank'][i].dayReturn*.4}));
 return {target,history:{rows},holdings:holding(),baseline:{return:.0001},quote:async(s,t)=>series[s].filter(b=>b.date<=t),legacy:async t=>({return:rows.find(r=>r.date===t).dailyReturn+.0002})};
}
test('期限配置候选完整选择、封存、回放及未来净值隔离，旧方法独立统计',async()=>{
 const f=fixture(),ref=await adaptiveBondReference(f.target,f);assert.equal(ref.method,'bond-fit-v4');assert.equal(ref.durationValidation.accepted,true);assert.equal(durationFitIssue(ref),null);
 assert.equal(ref.disclosure.durationHint.governmentWeight,60);assert.ok(ref.validation.to<f.target);
 const changed=await adaptiveBondReference(f.target,{...f,history:{rows:[...f.history.rows.filter(r=>r.date<f.target),{date:f.target,dailyReturn:100,value:1}]}});assert.deepEqual(changed.coeffs,ref.coeffs);
 const future=await adaptiveBondReference(f.target,{...f,holdings:{...f.holdings,disclosures:[{...d,publishedAt:f.target}]}});assert.notEqual(future.method,'bond-fit-v4');
 const mismatch=await adaptiveBondReference(f.target,{...f,holdings:{...f.holdings,asOf:'2026-09-30'}});assert.notEqual(mismatch.method,'bond-fit-v4');
 const base={date:expectedCloseDate(shiftDate(f.target,-1),'CN'),value:1.2},now=new Date(f.target+'T19:00:00+08:00');
 const {candidate}=await bondFitForecast(f.target,{base,now,reference:async()=>ref});assert.ok(candidate);assert.equal(forecastIssue(candidate),null);assert.equal(replayForecast(candidate).return,candidate.model.return);
 for(const mutate of [f=>{f.fit.disclosure.durationHint.governmentWeight=99;},f=>{f.fit.config.durationAware=false;},f=>{f.fit.durationValidation.accepted=false;},f=>{f.fit.durationValidation.to=f.date;},f=>{f.fit.durationValidation.candidate.worst=1;},f=>{f.fit.config.ridge=99;}]){const x=structuredClone(candidate);mutate(x);assert.ok(forecastIssue(x));}
 const record={forecast:candidate,firstForecastAt:now.toISOString(),firstActualSeenAt:f.target+'T20:00:00+08:00',actual:{date:f.target,previousDate:base.date,dailyReturn:0}};
 assert.equal(forecastStats('888888',{['888888:'+f.target]:record}).groups[0].method,'bond-fit-v4');
});
