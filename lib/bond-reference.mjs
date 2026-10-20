import {bondBars} from './provider.mjs';

// Bond index quotes as risk factors. Eastmoney serves no kline for these SH
// bond indices, so bondBars reads Tencent (Sina backup). Every fund is fitted
// on its OWN published history against the same three factors, so a rate fund,
// a credit fund and a convertible fund each get their own sensitivities:
//   x1 = treasury return                 (rate/duration exposure)
//   x2 = corporate − treasury            (on-exchange credit spread exposure)
//   x3 = convertible − treasury          (equity-linked exposure)
// The intercept absorbs the daily coupon accrual.
export const BOND_FACTORS=[
 {symbol:'000012',name:'上证国债指数'},
 {symbol:'000013',name:'上证企债指数'},
 {symbol:'000832',name:'中证转债指数'},
];
export const MIN_BOND_SAMPLES=60,MIN_BOND_R2=0.3;

// 4-parameter OLS by Gauss-Jordan on the normal equations; null when the
// design is degenerate (a factor never moves in the sample).
function solveOls(pairs){
 const k=4,A=Array.from({length:k},()=>new Array(k+1).fill(0));
 const my=pairs.reduce((s,p)=>s+p.y,0)/pairs.length;
 for(const p of pairs){
  const x=[1,p.x[0],p.x[1],p.x[2]];
  for(let i=0;i<k;i++){for(let j=0;j<k;j++)A[i][j]+=x[i]*x[j];A[i][k]+=x[i]*p.y;}
 }
 for(let c=0;c<k;c++){
  let piv=c;for(let r=c+1;r<k;r++)if(Math.abs(A[r][c])>Math.abs(A[piv][c]))piv=r;
  if(Math.abs(A[piv][c])<1e-14)return null;
  [A[c],A[piv]]=[A[piv],A[c]];
  for(let r=0;r<k;r++){
   if(r===c)continue;
   const f=A[r][c]/A[c][c];
   for(let j=c;j<=k;j++)A[r][j]-=f*A[c][j];
  }
 }
 const coeffs=A.map((row,i)=>row[k]/row[i]);
 if(!coeffs.every(Number.isFinite))return null;
 let ssres=0,sstot=0;
 for(const p of pairs){
  const e=p.y-(coeffs[0]+coeffs[1]*p.x[0]+coeffs[2]*p.x[1]+coeffs[3]*p.x[2]);
  ssres+=e*e;sstot+=(p.y-my)**2;
 }
 if(!(sstot>0))return null;
 return {coeffs,r2:1-ssres/sstot};
}
const design=t=>{const [treasury,corp,conv]=t;return [treasury,corp-treasury,conv-treasury];};

export async function bondReference(target,{history,quote=bondBars,minSamples=MIN_BOND_SAMPLES,minR2=MIN_BOND_R2,now=new Date()}={}){
 const src=(history?.rows??[]).slice().sort((a,b)=>a.date.localeCompare(b.date)).slice(-160);
 const rows=src.map((r,i)=>({...r,dr:Number.isFinite(r.dailyReturn)?r.dailyReturn:(i&&src[i-1].value>0&&r.value>0?r.value/src[i-1].value-1:null)})).filter(r=>Number.isFinite(r.dr));
 const series=[];
 for(const f of BOND_FACTORS){
  let s;try{s=await quote(f.symbol,target);}catch{return null;}
  series.push(new Map((s??[]).map(b=>[b.date,b])));
 }
 const pairs=[];
 for(const r of rows){
  const bars=series.map(m=>m.get(r.date));
  if(bars.some(b=>!b||!Number.isFinite(b.dayReturn)))continue;
  pairs.push({x:design(bars.map(b=>b.dayReturn)),y:r.dr});
 }
 const n=pairs.length;
 if(n<minSamples)return {return:null,unavailable:'拟合样本不足（'+n+'/'+minSamples+'）',samples:n};
 const fit=solveOls(pairs);
 if(!fit)return {return:null,unavailable:'历史波动不足，无法拟合',samples:n};
 if(fit.r2<minR2)return {return:null,unavailable:'拟合质量不足（R² '+fit.r2.toFixed(2)+'）',samples:n,r2:fit.r2};
 // Before the CN open, quote vendors still publish a "today" bar holding the
 // previous session's value; label it carried instead of a live move.
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 const preOpen=`${p.year}-${p.month}-${p.day}`===target&&Number(p.hour)+Number(p.minute)/60<9.5;
 const factors=BOND_FACTORS.map((f,i)=>{
  const m=series[i];
  const bar=m.get(target)??[...m.values()].filter(x=>x.date<=target&&Number.isFinite(x.dayReturn)).sort((q,w)=>w.date.localeCompare(q.date))[0];
  return bar?{symbol:f.symbol,name:f.name,date:bar.date,dayReturn:bar.dayReturn,carried:bar.date!==target||preOpen}:null;
 });
 if(factors.some(f=>!f))return {return:null,unavailable:'目标日无债券指数行情',samples:n,r2:fit.r2};
 const c=fit.coeffs,x=design(factors.map(f=>f.dayReturn));
 return {return:c[0]+c[1]*x[0]+c[2]*x[1]+c[3]*x[2],r2:fit.r2,samples:n,coeffs:c,factors,
  carried:factors.some(f=>f.carried),indexDate:factors[0].date,source:'国债/企债/转债指数多因子历史拟合（非预估）'};
}
