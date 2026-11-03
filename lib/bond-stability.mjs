// Fixed candidate and chronological confirmation; no target NAV is an input.
export const STABLE_BOND_MODEL='bond-fit-v3';
export const STABLE_CONFIGS=[
 {window:160,halfLife:60,ridge:.2,leverageCap:3},
 {window:90,halfLife:30,ridge:1,leverageCap:3},
 {window:160,halfLife:0,ridge:.05,leverageCap:3},
];
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
export const bondPrediction=(c,x)=>c[0]+x.reduce((s,v,j)=>s+c[j+1]*v,0);
export function bondErrors(errors){
 const ordered=errors.map(Math.abs).sort((a,b)=>a-b);
 return {count:errors.length,mae:mean(ordered),worst:ordered.at(-1),p90:ordered[Math.ceil(ordered.length*.9)-1],bias:mean(errors)};
}
export function stableBondFit(rows,disclosure,fitter){
 const members=STABLE_CONFIGS.map(config=>fitter(rows,disclosure,config));
 if(members.some(f=>!f))return null;
 const coeffs=members[0].coeffs.map((_,j)=>mean(members.map(f=>f.coeffs[j])));
 const ps=rows.slice(-90),my=mean(ps.map(r=>r.y)),sst=ps.reduce((s,r)=>s+(r.y-my)**2,0);
 const r2=1-ps.reduce((s,r)=>s+(r.y-bondPrediction(coeffs,r.x))**2,0)/sst;
 if(!Number.isFinite(r2)||r2<.3)return null;
 return {coeffs,samples:Math.min(...members.map(f=>f.samples)),r2,
  config:{strategy:'leverage-capped-ensemble-v1'},members};
}
export function stableBondChoice(evaluations){
 if(evaluations.length!==30||evaluations.some(e=>!Number.isFinite(e.stableError)))return null;
 // Choose the incumbent on the first 20 days; the final 10 never choose it.
 const selection=evaluations.slice(0,20),confirmation=evaluations.slice(20);
 const index=[0,1,2].sort((a,b)=>bondErrors(selection.map(e=>e.errors[a])).mae-bondErrors(selection.map(e=>e.errors[b])).mae)[0];
 const summarize=rs=>({count:rs.length,from:rs[0].date,to:rs.at(-1).date,
  incumbent:bondErrors(rs.map(e=>e.errors[index])),candidate:bondErrors(rs.map(e=>e.stableError))});
 const chosen=summarize(selection),confirmed=summarize(confirmation);
 const improves=s=>s.candidate.mae<s.incumbent.mae*.95&&s.candidate.worst<=s.incumbent.worst*1.1;
 return {accepted:improves(chosen)&&improves(confirmed),incumbentIndex:index,selection:chosen,confirmation:confirmed};
}
export function bondReliability(errors,memberReturns=[]){
 const s=bondErrors(errors),spread=memberReturns.length?Math.max(...memberReturns)-Math.min(...memberReturns):0;
 // An empirical error band, not a probability or a guarantee of future coverage.
 const halfWidth=Math.max(s.p90,spread/2);
 return {schema:1,count:s.count,mae:s.mae,p90:s.p90,worst:s.worst,halfWidth,spread,
  level:s.mae>.0003||s.worst>.001||spread>.001?'low':'reference',unit:'return'};
}
export function stableFitIssue(fit){
 const v=fit?.stability,m=fit?.members;
 if(fit?.config?.strategy!=='leverage-capped-ensemble-v1'||!Array.isArray(m)||m.length!==3)return '稳定组合输入不完整';
 if(m.some((f,i)=>!f||f.samples<60||!Array.isArray(f.coeffs)||f.coeffs.length!==9||!f.coeffs.every(Number.isFinite)||f.coeffs.slice(1).some(v=>v<0)||Object.entries(STABLE_CONFIGS[i]).some(([k,v])=>f.config?.[k]!==v)))return '稳定组合成员无效';
 if(fit.coeffs?.some((c,j)=>Math.abs(c-mean(m.map(f=>f.coeffs[j])))>1e-12))return '稳定组合系数不一致';
 const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(s??'');
 if(v?.accepted!==true||![0,1,2].includes(v.incumbentIndex))return '稳定组合缺少独立确认';
 for(const [key,count] of [['selection',20],['confirmation',10]]){
  const s=v[key];if(s?.count!==count||!date(s.from)||!date(s.to)||s.from>s.to)return '稳定组合验证日期无效';
  for(const e of [s.incumbent,s.candidate])if(e?.count!==count||![e.mae,e.worst,e.p90].every(x=>Number.isFinite(x)&&x>=0)||e.mae>e.worst+1e-12||e.p90>e.worst)return '稳定组合验证误差无效';
  if(!(s.candidate.mae<s.incumbent.mae*.95&&s.candidate.worst<=s.incumbent.worst*1.1))return '稳定组合未通过独立确认';
 }
 if(v.selection.to>=v.confirmation.from||v.selection.from!==fit.validation?.from||v.confirmation.to!==fit.validation?.to)return '稳定组合验证窗口重叠';
 return null;
}
