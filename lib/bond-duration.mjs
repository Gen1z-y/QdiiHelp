// A disclosed ultra-long government holding informs a soft 30Y proxy prior.
// It does not identify the entire portfolio or assume every bond is exactly 30Y.
const dateOK=s=>/^\d{4}-\d{2}-\d{2}$/.test(s??'');
const ultraName=s=>/^\d{2}超长特别国债\d{2}$/.test(String(s??'').replace(/\s/g,''));
export const DURATION_BOND_MODEL='bond-fit-v4';
export function durationHint(holding){
 if(!dateOK(holding?.asOf)||!Array.isArray(holding.rows))return null;
 const seen=new Set(),rows=[];
 for(const r of holding.rows){
  if(!ultraName(r.name))continue;
  if(typeof r.code!=='string'||!r.code||seen.has(r.code)||!Number.isFinite(r.weight)||r.weight<=0||r.weight>100)return null;
  seen.add(r.code);rows.push({code:r.code,name:r.name,weight:r.weight});
 }
 if(!rows.length)return null;
 const governmentWeight=rows.reduce((s,r)=>s+r.weight,0);
 return governmentWeight<=200?{schema:1,asOf:holding.asOf,proxy:'cb:ultra',governmentWeight,rows}:null;
}
export function validDurationHint(hint,disclosure){
 if(hint?.schema!==1||hint.proxy!=='cb:ultra'||hint.asOf!==disclosure?.asOf)return false;
 const check=durationHint({asOf:hint.asOf,rows:hint.rows});
 return !!check&&Math.abs(check.governmentWeight-hint.governmentWeight)<1e-9
  &&Number.isFinite(disclosure.categories?.government)&&hint.governmentWeight<=disclosure.categories.government;
}
export function durationDisclosures(holding){
 const hints=[durationHint(holding),...(Array.isArray(holding?.durationHints)?holding.durationHints:[]).filter(h=>h&&h.asOf!==holding?.asOf)].filter(Boolean);
 return (holding?.disclosures??[]).map(d=>{
  const hint=hints.find(h=>validDurationHint(h,d));
  const {durationHint:unused,...raw}=d;return hint?{...raw,durationHint:hint}:raw;
 });
}
export function durationChoice(evaluations,bestIndex){
 if(evaluations.length!==30||evaluations.some(e=>!Array.isArray(e.durationErrors)||e.durationErrors.length!==3||!e.durationErrors.every(Number.isFinite)))return null;
 const stats=errors=>({mae:errors.reduce((s,v)=>s+Math.abs(v),0)/errors.length,worst:Math.max(...errors.map(Math.abs)),recentMae:errors.slice(-10).reduce((s,v)=>s+Math.abs(v),0)/10});
 const incumbent=stats(evaluations.map(e=>e.errors[bestIndex]));
 const candidates=[0,1,2].map(index=>({index,...stats(evaluations.map(e=>e.durationErrors[index]))})).sort((a,b)=>a.mae-b.mae);
 const best=candidates[0];
 return {accepted:best.mae<incumbent.mae&&best.worst<=incumbent.worst&&best.recentMae<=incumbent.recentMae,
  index:best.index,count:30,from:evaluations[0].date,to:evaluations.at(-1).date,incumbent,candidate:best};
}
export function durationFitIssue(fit){
 const v=fit?.durationValidation;
 const configs=[{window:160,halfLife:60,ridge:.2},{window:90,halfLife:30,ridge:1},{window:160,halfLife:0,ridge:.05}];
 if(fit?.config?.durationAware!==true||!validDurationHint(fit.disclosure?.durationHint,fit.disclosure)||v?.accepted!==true||v.count!==30||![0,1,2].includes(v.index)
  ||v.from!==fit.validation?.from||v.to!==fit.validation?.to)return '超长债配置证据不完整';
 if(Object.entries(configs[v.index]).some(([key,value])=>fit.config[key]!==value)||v.candidate?.index!==v.index)return '超长债配置参数与验证不一致';
 if([v.incumbent,v.candidate].some(s=>!s||![s.mae,s.worst,s.recentMae].every(x=>Number.isFinite(x)&&x>=0)))return '超长债配置验证误差无效';
 if(!(v.candidate.mae<v.incumbent.mae&&v.candidate.worst<=v.incumbent.worst&&v.candidate.recentMae<=v.incumbent.recentMae))return '超长债配置候选未改善历史误差';
 return null;
}
