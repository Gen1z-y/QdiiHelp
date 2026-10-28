import {session,shiftDate,marketId,marketStatus} from './calendar.mjs';
import {validDate} from './model.mjs';

export const PERIOD_VERSION='fund-period-v1';
export function periodDays(from,to){
 if(!validDate(from)||!validDate(to)||from>=to)return null;
 let count=0;
 for(let d=shiftDate(from,1),i=0;d<=to&&i<3660;i++,d=shiftDate(d,1))if(!session(d,'CN').closed)count++;
 return count;
}
export function publishedPeriod(row){
 const value=Number.isFinite(row?.dailyReturn)?row.dailyReturn:row?.intervalReturn;
 const from=row?.returnFrom??row?.previousDate,to=row?.returnTo??row?.date;
 return {from:validDate(from)?from:null,to:validDate(to)?to:null,return:Number.isFinite(value)?value:null,
  metric:'nav-return',currency:row?.currency??'CNY',intervalOnly:!Number.isFinite(row?.dailyReturn)&&Number.isFinite(row?.intervalReturn)};
}
export function exposureMarkets(holding,indexId=null){
 if(indexId)return {markets:['US'],known:true,timingComplete:true,source:'跟踪指数'};
 const names={'美国':'US','香港':'HK','中国内地':'CN','日本':'JP','韩国':'KR'};
 const rows=(holding?.rows??[]).filter(r=>r.weight>0);
 const ids=rows.map(r=>marketId(r.secid)??names[r.market]);
 const weight=rows.reduce((sum,r)=>sum+r.weight,0),known=rows.length>0&&ids.every(Boolean);
 return {markets:[...new Set(ids.filter(Boolean))],known,timingComplete:known&&weight>=99.5&&weight<=100.5,
  disclosedWeight:weight,source:'披露持仓',holdingDate:holding?.asOf??null};
}
export function marketProgress(fund,now=new Date()){
 const forecast=fund.record?.forecast??fund.record?.partialForecast??fund.analysis;
 const rows=forecast?.rows?.length?forecast.rows:fund.latestHoldings?.rows??[];
 const target=fund.asOf??fund.date;
 const groups=new Map();
 for(const r of rows.filter(r=>r.weight>0)){
  const id=marketId(r.secid)??({'美国':'US','香港':'HK','中国内地':'CN','日本':'JP','韩国':'KR'}[r.market]);
  const name=r.market??id??'未识别市场',key=id??name;
  const status=forecast?.date===target&&r.marketStatus?r.marketStatus:id?marketStatus(target,id,now):{state:'unknown',message:'市场尚未匹配'};
  const g=groups.get(key)??{market:id??null,name,weight:0,state:status.state,reason:status.message,usableWeight:0,quoteDates:[]};
  g.weight+=r.weight;
  if(Number.isFinite(r.rmbReturn))g.usableWeight+=r.weight;
  if(r.stock?.target?.date&&!g.quoteDates.includes(r.stock.target.date))g.quoteDates.push(r.stock.target.date);
  if((r.error||!Number.isFinite(r.rmbReturn))&&g.state!=='pending'){g.state='missing';g.reason=r.error??'缺少区间有效行情';}
  groups.set(key,g);
 }
 if(!groups.size&&forecast?.indexQuote){
  const q=forecast.indexQuote,s=q.marketStatus??marketStatus(target,'US',now);
  groups.set('US',{market:'US',name:'美国',weight:100,usableWeight:q.stale||q.error?0:100,state:q.error?'missing':s.state,reason:q.error??s.message,quoteDates:[q.date].filter(Boolean)});
 }
 return [...groups.values()];
}
export function pendingPublications(code,records,target,limit=30){
 return Object.entries(records).filter(([key,r])=>key.startsWith(code+':')&&key.slice(7)<=target&&!r.actual&&(r.forecast||r.partialForecast))
  .sort(([a],[b])=>b.localeCompare(a)).slice(0,limit).map(([key,r])=>{
   const f=r.forecast??r.partialForecast;
   return {date:key.slice(7),from:f.base?.date,asOf:f.asOf??f.date,return:f.model?.return??null,
    partial:(f.asOf??f.date)<key.slice(7),referenceOnly:!!f.referenceOnly,provisional:!!f.base?.provisional,sealed:!!r.sealedAt};
  });
}
// Lightweight per-asOf snapshots: never replace the original forecast/evidence.
export function captureStage(record,forecast,target,now){
 if(!forecast||record.actual||!Number.isFinite(forecast.model?.return))return record;
 const asOf=forecast.asOf??forecast.date;
 if(!validDate(asOf)||!validDate(forecast.base?.date)||asOf<=forecast.base.date)return record;
 const stage={date:asOf,target,from:forecast.base.date,return:forecast.model.return,value:forecast.model.value,
  dailyReturn:forecast.model.dailyReturn,calculatedAt:forecast.calculatedAt??now,referenceOnly:!!forecast.referenceOnly,
  provisional:!!forecast.base.provisional,holdingsDate:forecast.holdingsDate??null};
 const prior=record.stages??[];
 // First completed snapshot for an asOf day remains an honest historical reference.
 if(prior.some(s=>s.date===asOf&&s.target===target&&!s.provisional))return record;
 return {...record,stages:[...prior.filter(s=>s.date!==asOf||s.target!==target),stage].sort((a,b)=>a.date.localeCompare(b.date)).slice(-120)};
}
