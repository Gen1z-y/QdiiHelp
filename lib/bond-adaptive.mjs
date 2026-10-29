import {disclosureAt} from './bond-disclosure.mjs';
import {ADAPTIVE_BOND_FACTORS,bondWealthBars} from './bond-factors.mjs';
import {expectedCloseDate,shiftDate} from './calendar.mjs';

export const ADAPTIVE_BOND_MODEL='bond-fit-v2';
export const BOND_VALIDATION_DAYS=30;
const configs=[{window:160,halfLife:60,ridge:.2},{window:90,halfLife:30,ridge:1},{window:160,halfLife:0,ridge:.05}];
const symbols=ADAPTIVE_BOND_FACTORS.map(f=>f.symbol);
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const predict=(c,x)=>c[0]+x.reduce((s,v,j)=>s+c[j+1]*v,0);
export function pureBondDisclosure(d){return d?.stockWeight===0&&d?.categories?.convertible===0;}
function prior(d){
 const c=d.categories;
 return [c.government/200,c.government/200+c.other/100,0,c.policy/100,(c.corporate+c.commercialPaper)/100,(c.financial-c.policy)/100,c.mtn/100,c.cd/100];
}
// Standardized, non-negative ridge fit around disclosed NAV exposures. Weights
// above 100% remain above 100%. The intercept is a residual, not a second coupon.
export function fitBondRidge(rows,disclosure,config=configs[0]){
 if(rows.length<60||!pureBondDisclosure(disclosure))return null;
 const ps=rows.slice(-config.window),n=ps.length,k=symbols.length;
 const w=ps.map((_,i)=>config.halfLife?2**((i-n+1)/config.halfLife):1),sw=w.reduce((s,v)=>s+v,0);
 const mx=Array.from({length:k},(_,j)=>ps.reduce((s,p,i)=>s+w[i]*p.x[j],0)/sw),my=ps.reduce((s,p,i)=>s+w[i]*p.y,0)/sw;
 const scale=mx.map((m,j)=>Math.sqrt(ps.reduce((s,p,i)=>s+w[i]*(p.x[j]-m)**2,0)/sw));
 if(scale.some(v=>!Number.isFinite(v)||v<1e-10))return null;
 const z=ps.map(p=>p.x.map((v,j)=>(v-mx[j])/scale[j]));
 const anchor=prior(disclosure).map((v,j)=>v*scale[j]),beta=[...anchor],a=Array.from({length:k},()=>Array(k).fill(0)),b=Array(k).fill(0);
 for(let i=0;i<n;i++)for(let j=0;j<k;j++){
  b[j]+=w[i]*z[i][j]*(ps[i].y-my);
  for(let l=0;l<k;l++)a[j][l]+=w[i]*z[i][j]*z[i][l];
 }
 const penalty=config.ridge*sw;
 for(let pass=0;pass<200;pass++){
  let delta=0;
  for(let j=0;j<k;j++){
   let rhs=b[j]+penalty*anchor[j];for(let l=0;l<k;l++)if(l!==j)rhs-=a[j][l]*beta[l];
   const next=Math.max(0,rhs/(a[j][j]+penalty));delta=Math.max(delta,Math.abs(next-beta[j]));beta[j]=next;
  }
  if(delta<1e-12)break;
 }
 const slopes=beta.map((v,j)=>v/scale[j]),coeffs=[my-slopes.reduce((s,v,j)=>s+v*mx[j],0),...slopes];
 const sst=ps.reduce((s,p)=>s+(p.y-my)**2,0),sse=ps.reduce((s,p)=>s+(p.y-predict(coeffs,p.x))**2,0);
 if(!(sst>0)||!coeffs.every(Number.isFinite)||slopes.reduce((s,v)=>s+v,0)>5)return null;
 return {coeffs,samples:n,r2:1-sse/sst,config};
}
export function adaptiveFitReturn(fit,date){
 if(!fit||fit.coeffs?.length!==symbols.length+1||!fit.coeffs.every(Number.isFinite)||fit.coeffs.slice(1).some(v=>v<0)||fit.factors?.length!==symbols.length)return null;
 const bars=symbols.map(s=>fit.factors.find(f=>f.symbol===s));
 if(bars.some(f=>!f||!Number.isFinite(f.dayReturn)||(date&&(f.date!==date||f.carried))))return null;
 const ret=predict(fit.coeffs,bars.map(f=>f.dayReturn));return Number.isFinite(ret)?ret:null;
}
function summary(errors){return {count:errors.length,mae:mean(errors.map(Math.abs)),worst:Math.max(...errors.map(Math.abs)),bias:mean(errors)};}

export async function adaptiveBondReference(target,{history,holdings,baseline,legacy,quote=bondWealthBars}={}){
 const fallback=(reason,validation)=>({...baseline,adaptive:{status:'fallback',reason,...(validation?{validation}:{})}});
 const disclosures=holdings?.disclosures;
 const current=disclosureAt(disclosures,target);
 if(!current)return fallback('缺少目标日前已公布的有效券种配置；请同步债券持仓');
 if(!pureBondDisclosure(current))return fallback('披露组合含股票或转债，保留原三指数模型');
 const loaded=await Promise.allSettled(symbols.map(s=>quote(s,target)));
 if(loaded.some(r=>r.status==='rejected'))return fallback('中债财富因子获取失败，保留原模型');
 const maps=loaded.map(r=>new Map(r.value.map(b=>[b.date,b])));
 const targetBars=maps.map(m=>m.get(target));
 const previous=expectedCloseDate(shiftDate(target,-1),'CN');
 if(targetBars.some(b=>!b||!Number.isFinite(b.dayReturn)||b.previousDate!==previous))return {...baseline,adaptive:{status:'pending',reason:'等待中债财富指数目标日及前一交易日收盘值；暂不封存原模型'}};
 const src=(history?.rows??[]).filter(r=>r.date<target).sort((a,b)=>a.date.localeCompare(b.date));
 const rows=[];
 for(let i=1;i<src.length;i++){
  const r=src[i],previous=src[i-1],expected=expectedCloseDate(shiftDate(r.date,-1),'CN');
  if(!Number.isFinite(r.dailyReturn)||r.adjustment||previous.date!==expected||(r.previousDate&&r.previousDate!==expected))continue;
  const bs=maps.map(m=>m.get(r.date));
  if(bs.some(b=>!b||!Number.isFinite(b.dayReturn)||b.previousDate!==previous.date))continue;
  rows.push({date:r.date,x:bs.map(b=>b.dayReturn),y:r.dailyReturn});
 }
 const dates=rows.slice(-BOND_VALIDATION_DAYS),evaluations=[];
 for(const row of dates){
  const d=disclosureAt(disclosures,row.date);if(!pureBondDisclosure(d))continue;
  const past=rows.filter(p=>p.date<row.date);
  const fits=configs.map(c=>fitBondRidge(past,d,c));if(fits.some(f=>!f))continue;
  const old=await legacy(row.date);if(!Number.isFinite(old?.return))continue;
  evaluations.push({date:row.date,baselineError:old.return-row.y,errors:fits.map(f=>predict(f.coeffs,row.x)-row.y)});
 }
 if(evaluations.length<BOND_VALIDATION_DAYS)return fallback('逐日验证样本不足（'+evaluations.length+'/'+BOND_VALIDATION_DAYS+'），暂用原模型');
 const old=summary(evaluations.map(e=>e.baselineError));
 const ranked=configs.map((config,i)=>({config,index:i,...summary(evaluations.map(e=>e.errors[i]))})).sort((a,b)=>a.mae-b.mae);
 const best=ranked[0],recent=evaluations.slice(-10),recentOld=mean(recent.map(e=>Math.abs(e.baselineError))),recentNew=mean(recent.map(e=>Math.abs(e.errors[best.index])));
 const validation={count:evaluations.length,from:evaluations[0].date,to:evaluations.at(-1).date,baselineMae:old.mae,candidateMae:best.mae,baselineWorst:old.worst,candidateWorst:best.worst,recentBaselineMae:recentOld,recentCandidateMae:recentNew,unit:'return',reconstructed:true};
 // This trailing window selects a candidate, not an independent proof of future
 // accuracy. Require improvement in overall MAE, recent MAE and tail error.
 if(!(best.mae<old.mae*.95&&best.worst<=old.worst*1.1&&recentNew<=recentOld*1.05))return fallback('候选未同时改善总体、近期及较大误差，保留原模型',validation);
 const fit=fitBondRidge(rows,current,best.config);
 if(!fit||fit.r2<.3)return fallback('当前候选拟合质量不足，保留原模型',validation);
 const factors=ADAPTIVE_BOND_FACTORS.map((f,i)=>({symbol:f.symbol,name:f.name,date:target,dayReturn:targetBars[i].dayReturn,previousDate:targetBars[i].previousDate,carried:false}));
 const ret=adaptiveFitReturn({...fit,factors},target);
 if(!Number.isFinite(ret))return fallback('候选输入无效，保留原模型',validation);
 return {return:ret,method:ADAPTIVE_BOND_MODEL,...fit,factors,indexDate:target,carried:false,
  disclosure:current,validation,adaptive:{status:'selected',reason:'持仓约束候选通过最近30日逐日选择门槛'},source:'持仓约束的中债财富指数滚动拟合（盘中仅参考）'};
}
