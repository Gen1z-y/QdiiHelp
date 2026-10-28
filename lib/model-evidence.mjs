import {createHash} from 'node:crypto';
import {estimateMarketIndex} from './indices.mjs';
import {MAX_HOLDINGS_AGE_DAYS} from './estimation-rules.mjs';

export function modelQuality(forecast,allocation,now=new Date()){
 const rows=forecast?.rows??[],coverage=forecast?.model?.coverage??0,age=forecast?.holdingsDate?(Date.parse(forecast.date)-Date.parse(forecast.holdingsDate))/86400000:null;
 const reasons=[];
 if(age>MAX_HOLDINGS_AGE_DAYS)reasons.push(`持仓超过${MAX_HOLDINGS_AGE_DAYS}天`);
 if(coverage<50)reasons.push('有效持仓覆盖不足50%');
 if(rows.some(r=>r.error))reasons.push('部分披露资产缺少有效行情');
 if(rows.some(r=>r.fx?.target&&forecast.date>r.fx.target.date||r.dailyFx?.target&&forecast.date>r.dailyFx.target.date))reasons.push('汇率沿用较早日期');
 if(allocation?.stock!=null&&Math.abs(rows.reduce((s,r)=>s+r.weight,0)-allocation.stock)>3)reasons.push('披露股票权重与资产配置存在差异');
 return {coverage,disclosed:rows.reduce((s,r)=>s+r.weight,0),holdingAgeDays:age===null?null:Math.floor(age),level:age>MAX_HOLDINGS_AGE_DAYS||coverage<20?'参考性弱':reasons.length?'存在缺口':'覆盖较充分',reasons,validated:false};
}

// A US broad-index proxy is only a challenger, never the published main estimate.
export function residualCandidate(forecast,allocation,quote,fx,dailyFx){
 if(!forecast||!allocation||allocation.date!==forecast.holdingsDate||!(allocation.stock>0&&allocation.stock<=100)||forecast.date<allocation.date||Date.parse(forecast.date)-Date.parse(allocation.date)>MAX_HOLDINGS_AGE_DAYS*86400000)return null;
 const coverage=forecast.model.coverage,missing=allocation.stock-coverage;
 const disclosed=forecast.rows.reduce((n,r)=>n+r.weight,0);
 const us=forecast.rows.filter(r=>r.currency==='USD'&&Number.isFinite(r.rmbReturn)).reduce((n,r)=>n+r.weight,0);
 if(!(missing>0&&coverage>=20&&us/coverage>=.8)||disclosed>allocation.stock+3)return null;
 const proxy=estimateMarketIndex(forecast.date,forecast.base,quote,fx,dailyFx);
 const cumulative=forecast.model.return+missing/100*proxy.model.return,daily=forecast.model.dailyReturn+missing/100*proxy.model.dailyReturn;
 return {method:'residual-us-spx-v1',return:cumulative,dailyReturn:daily,value:forecast.base.value*(1+cumulative),experimental:true,missingStockWeight:missing,proxy:quote.name,proxyDate:quote.date,allocation,assumption:'未知股票部分按标普500与美元汇率近似；债券、现金及其他资产贡献仍未估算，未经验证，不替换主预估'};
}

export function captureEvidence(record,forecast,extra,now){
 if(!forecast||record.actual)return;
 const holdingVersion=createHash('sha256').update(JSON.stringify({date:forecast.holdingsDate,rows:forecast.rows?.map(r=>({code:r.code,weight:r.weight,secid:r.secid}))})).digest('hex').slice(0,16);
 const inputs={model:forecast.model,rows:forecast.rows,indexQuote:forecast.indexQuote,fx:forecast.fx,dailyFx:forecast.dailyFx,allocation:extra.allocation,candidate:extra.candidate,holdingSource:extra.holdingSource};
 const fingerprint=createHash('sha256').update(JSON.stringify(inputs,(key,value)=>['checkedAt','fetchedAt','calculatedAt'].includes(key)?undefined:value)).digest('hex');
 if(record.evidence?.some(e=>e.fingerprint===fingerprint))return;
 // Database-loaded snapshot arrays can be frozen; append by replacement.
 record.evidence=[...(record.evidence??[])];
 record.evidence.push(structuredClone({schema:1,date:forecast.date,base:forecast.base,calculatedAt:forecast.calculatedAt,capturedAt:now,holdingVersion,holdingsDate:forecast.holdingsDate,...inputs,fingerprint}));
}

export function evidenceStats(records,code){
 const samples=[];let pending=0,rejected=0;
 for(const [key,r] of Object.entries(records).filter(([key])=>key.startsWith(code+':'))){
  const a=r.actual,byMethod=new Map();
  for(const e of r.evidence??[]){
   if(!a){pending++;continue;}
   if(a.previousDate!==e.base?.date||a.date!==e.date||!Number.isFinite(a.dailyReturn)||!(Date.parse(e.capturedAt)<Date.parse(r.firstActualSeenAt)&&Date.parse(e.calculatedAt)<=Date.parse(e.capturedAt))){rejected++;continue;}
   for(const m of [e.model,e.candidate].filter(Boolean))if(Number.isFinite(m.return))byMethod.set(m.method,{date:key.slice(7),method:m.method,error:(m.return-a.dailyReturn)*100,forecast:m.return,actual:a.dailyReturn});
  }
  samples.push(...byMethod.values());
 }
 const groups=[...new Set(samples.map(s=>s.method))].map(method=>{const all=samples.filter(s=>s.method===method).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,90),count=all.length;return {method,count,mae:all.reduce((n,s)=>n+Math.abs(s.error),0)/count,bias:all.reduce((n,s)=>n+s.error,0)/count,direction:all.filter(s=>Math.sign(s.forecast)===Math.sign(s.actual)).length/count,overHalf:all.filter(s=>Math.abs(s.error)>.5).length,overOne:all.filter(s=>Math.abs(s.error)>1).length};});
 return {groups,pending,rejected};
}
