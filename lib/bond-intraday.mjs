import {disclosureAt} from './bond-disclosure.mjs';
import {durationDisclosures} from './bond-duration.mjs';
import {pureBondDisclosure} from './bond-adaptive.mjs';
import {previousNavDate} from './nav-observation.mjs';

const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
const median=values=>{const a=[...values].sort((x,y)=>x-y);return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2;};
const weightKeys=['government','financial','policy','corporate','commercialPaper','mtn','cd','other','total'];
const windows={morning:'上午',afternoon:'下午',late:'尾盘'};
const windowFor=time=>time<'11:30'?'morning':time<'15:00'?'afternoon':'late';
const tenorProfiles={
 short:{label:'短端',credit:[.5,1,2],government:[1,2,3]},
 medium:{label:'中端',credit:[3,5,7],government:[3,5,7]},
 long:{label:'长端',credit:[7,10],government:[7,10]}
};
const tenorMethod='bond-curve-v2';
const minTenorPairs=15;
const shifted=(curve,terms)=>{
 const matches=terms.filter(term=>Number.isFinite(curve?.[term]));
 return matches.length?mean(matches.map(term=>-term*curve[term]/(1+.02*term/2))):null;
};

export function estimateBondCurve(target,{name,holdings,history,base,curves,time,tenor}){
 const disclosure=disclosureAt(durationDisclosures(holdings),target),c=disclosure?.categories;
 if(base?.date!==previousNavDate(target)||base.provisional||!(base.value>0)||!pureBondDisclosure(disclosure)||!weightKeys.every(k=>Number.isFinite(c[k])&&c[k]>=0)||!(c.total>0)||c.policy>c.financial+.01)return null;
 const nav=(history?.rows??[]).filter(r=>r.date<target&&!r.adjustment&&r.previousDate===previousNavDate(r.date)&&Number.isFinite(r.dailyReturn)).sort((a,b)=>a.date.localeCompare(b.date)).slice(-30);
 if(nav.length<10)return null;
 const carry=median(nav.map(r=>r.dailyReturn));
 const short=/中短债|短债|短期纯债/.test(name??'');
 const profile=tenorProfiles[tenor];
 const core=profile?.credit??(short?[1,2]:[2,3,5]);
 const government=profile?.government??(short?[1,2]:[3,5,7]);
 const longWeight=disclosure.durationHint?.governmentWeight??0;
 const policy=[curves.cdb,curves.eib,curves.adbc].map(c=>shifted(c,core)).filter(Number.isFinite);
 const paper=shifted(curves.paper,[.5,1]),mtn=shifted(curves.mtn,core),shortCredit=shifted(curves.mtn,[.5,1]);
 const movements=[
  ['国债',c.government-longWeight,shifted(curves.government,government),true],
  ['超长国债',longWeight,shifted(curves.government,[20,30]),true],
  ['政策性金融债',c.policy,policy.length?mean(policy):null,true],
  ['企业债',c.corporate,mtn,false],
  ['中票',c.mtn,mtn,true],
  ['短融',c.commercialPaper,paper??shortCredit,Number.isFinite(paper)],
  ['非政策金融债',Math.max(0,c.financial-c.policy),mtn??shifted(curves.cdb,core),false],
  ['同业存单',c.cd,shortCredit,false]
 ];
 const priced=movements.filter(([,weight,move])=>weight>0&&Number.isFinite(move));
 const coverage=Math.min(1,priced.reduce((sum,[,weight])=>sum+weight,0)/c.total);
 if(coverage<.8||longWeight>=1&&!Number.isFinite(movements[1][2]))return null;
 const directCoverage=Math.min(1,priced.filter(row=>row[3]).reduce((sum,[,weight])=>sum+weight,0)/c.total);
 const contributions=priced.map(([name,weight,move])=>({name,weight,return:weight/100*move}));
 const value=carry+contributions.reduce((sum,row)=>sum+row.return,0);
 return {method:profile?tenorMethod:'bond-curve-v1',date:target,baseDate:base.date,time,return:value,carry,coverage,directCoverage,disclosedAt:disclosure.asOf,contributions,
  ...(profile?{tenor,tenorLabel:profile.label}:{})};
}

export function estimateBondTenors(target,options){
 return Object.fromEntries(Object.keys(tenorProfiles).map(tenor=>[tenor,estimateBondCurve(target,{...options,tenor})]));
}

export function captureBondTenors(record,{date,time,legacy,candidates,baseline,now}){
 if(record.actual?.date===date||!time||!Number.isFinite(legacy?.return))return false;
 const window=windowFor(time),before=record.bondTenors?.[window]??{};
 const entries=Object.entries(candidates??{}).flatMap(([tenor,fit])=>{
  if(before[tenor]||!Number.isFinite(fit?.return))return [];
  return [[tenor,{date,time,at:now.toISOString(),asOf:fit.disclosedAt,
   estimate:fit.return,legacy:legacy.return,index:Number.isFinite(baseline?.return)?baseline.return:null}]];
 });
 if(!entries.length)return false;
 record.bondTenors={...record.bondTenors,[window]:{...before,...Object.fromEntries(entries)}};
 return true;
}

function comparableActual(sample,actual,firstActualSeenAt){
 return actual?.date===sample.date&&!actual.adjustment&&!actual.returnSource&&actual.previousDate===previousNavDate(sample.date)
  &&Number.isFinite(actual.dailyReturn)&&Date.parse(sample.at)<Date.parse(firstActualSeenAt);
}

function errorStats(values){
 if(!values.length)return null;
 const ranked=[...values].sort((a,b)=>a-b);
 return {mae:mean(values),p90:ranked[Math.ceil(values.length*.9)-1]};
}

function improvesTenor(pairs,baseline){
 if(pairs.length<minTenorPairs)return false;
 const errors=pairs.map(pair=>pair.estimate),old=pairs.map(pair=>pair[baseline]);
 const candidate=errorStats(errors),reference=errorStats(old);
 return candidate.mae<reference.mae*.95&&candidate.p90<=reference.p90&&mean(errors.slice(0,5))<=mean(old.slice(0,5));
}

export function selectBondTenor(candidates,records,target,time){
 const window=windowFor(time);
 const days=Object.entries(records).filter(([key,record])=>key.slice(7)<target&&record.bondTenors?.[window])
  .sort(([a],[b])=>b.localeCompare(a)).slice(0,60);
 const qualified=Object.entries(candidates).flatMap(([tenor,fit])=>{
  if(!fit)return [];
  const pairs=days.flatMap(([,record])=>{
   const sample=record.bondTenors[window][tenor];
   if(!sample||sample.asOf!==fit.disclosedAt||!comparableActual(sample,record.actual,record.firstActualSeenAt)
      ||!Number.isFinite(sample.estimate)||!Number.isFinite(sample.legacy))return [];
   const actual=record.actual.dailyReturn;
   return [{estimate:Math.abs(sample.estimate-actual),legacy:Math.abs(sample.legacy-actual),index:Number.isFinite(sample.index)?Math.abs(sample.index-actual):null}];
  });
  if(!improvesTenor(pairs,'legacy'))return [];
  const validation={pairs:pairs.length,candidate:errorStats(pairs.map(p=>p.estimate)),legacy:errorStats(pairs.map(p=>p.legacy))};
  return [{...fit,validation,preferred:improvesTenor(pairs.filter(p=>p.index!==null),'index')}];
 });
 // Compare relative improvement because some curves are missing on different days.
 return qualified.sort((a,b)=>a.validation.candidate.mae/a.validation.legacy.mae-b.validation.candidate.mae/b.validation.legacy.mae)[0]??null;
}

// Keep the first available pair per session, so later refreshes cannot choose
// the best-looking estimate after the publication comes in.
export function captureBondComparison(record,{date,time,curve,baseline,now}){
 if(record.actual?.date===date||!time)return false;
 const window=windowFor(time),before=record.bondComparisons?.[window];
 const hasCurve=Number.isFinite(curve?.return),hasBaseline=Number.isFinite(baseline?.return);
 const curveSeen=hasCurve||before?.curveSeen===true,baselineSeen=hasBaseline||before?.baselineSeen===true;
 const paired=hasCurve&&hasBaseline;
 if(before?.paired)return false;
 if(before&&!paired&&curveSeen===before.curveSeen&&baselineSeen===before.baselineSeen)return false;
 record.bondComparisons={...record.bondComparisons,[window]:{
  date,time,at:now.toISOString(),curve:hasCurve?curve.return:null,baseline:hasBaseline?baseline.return:null,paired,curveSeen,baselineSeen
 }};
 return true;
}

export function bondComparisonStats(records,target){
 const days=Object.entries(records).filter(([key,record])=>record.bondComparisons&&key.slice(7)<=target).sort(([a],[b])=>b.localeCompare(a));
 return Object.fromEntries(Object.entries(windows).map(([window,label])=>{
  const observations=days.flatMap(([,r])=>r.bondComparisons?.[window]?[[r.bondComparisons[window],r]]:[]).slice(0,60);
  const pairs=observations.flatMap(([sample,{actual,firstActualSeenAt}])=>{
   if(!sample.paired||!Number.isFinite(sample.curve)||!Number.isFinite(sample.baseline)||!comparableActual(sample,actual,firstActualSeenAt))return [];
   const value=actual.dailyReturn;
   const blended=(sample.curve+sample.baseline)/2;
   return [[Math.abs(sample.curve-value),Math.abs(sample.baseline-value),Math.abs(blended-value)]];
  });
  const error=column=>errorStats(pairs.map(row=>row[column]));
  const curve=error(0),baseline=error(1),blend=error(2);
  // Use a fixed weight and compare only paired observations from this session.
  const blendPreferred=pairs.length>=6&&blend.mae<Math.min(curve.mae,baseline.mae)*.95
    &&blend.p90<=Math.min(curve.p90,baseline.p90)*1.05;
  return [window,{label,observed:observations.length,curveDays:observations.filter(([s])=>s.curveSeen).length,baselineDays:observations.filter(([s])=>s.baselineSeen).length,pairs:pairs.length,curve,baseline,blend,blendPreferred,
   preferred:pairs.length>=15&&curve.mae<baseline.mae*.95&&curve.p90<=baseline.p90}];
 }));
}

export function blendBondReference(curve,index,comparison){
 if(curve?.method!=='bond-curve-v1'||!curve.time||index?.indexDate!==curve.date||index.carried||index.adaptive?.status==='unreliable'
    ||!Number.isFinite(curve.return)||!Number.isFinite(index.return))return null;
 const stats=comparison?.[windowFor(curve.time)];
 if(!stats?.blendPreferred)return null;
 return {date:curve.date,time:curve.time,baseDate:curve.baseDate,return:(curve.return+index.return)/2,
  validation:{pairs:stats.pairs,mae:stats.blend.mae}};
}

export function preferBondCurve(curve,comparison){
 if(curve?.method===tenorMethod)return curve.preferred===true;
 return !!curve&&comparison?.[windowFor(curve.time)]?.preferred===true;
}
