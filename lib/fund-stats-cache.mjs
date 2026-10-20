import {forecastStats} from './forecast-stats.mjs';

// Index observations once and keep the index in step with normal record writes.
export class FundStatsCache {
 constructor(){this.groups=new Map();this.cache=new Map();}
 bind(records){
  if(records===this.proxy)return this.proxy;
  this.groups.clear();this.cache.clear();
  const put=(key,value)=>{if(typeof key!=='string')return;const code=key.slice(0,6);if(!this.groups.has(code))this.groups.set(code,{});this.groups.get(code)[key]=value;this.cache.delete(code);};
  for(const [key,value] of Object.entries(records))put(key,value);
  this.proxy=new Proxy(records,{set:(target,key,value)=>{target[key]=value;put(key,value);return true;},deleteProperty:(target,key)=>{delete target[key];this.groups.get(String(key).slice(0,6))&&delete this.groups.get(String(key).slice(0,6))[key];this.cache.delete(String(key).slice(0,6));return true;}});
  return this.proxy;
 }
 forFund(code){return this.groups.get(code)??{};}
 get(code,options={}){
  const records=this.forFund(code);
  // Small fields only: never serialize input rows or evidence to validate a cache.
  const signature=JSON.stringify(Object.entries(records).map(([key,r])=>{const f=r.forecast,a=r.actual;return [key,f?.date,f?.base?.date,f?.base?.provisional,f?.model?.method,f?.model?.return,f?.calculatedAt,r.firstForecastAt,r.firstActualSeenAt,a?.date,a?.previousDate,a?.dailyReturn,r.indexClose,r.rejectedForecasts?.length,r.rejectedForecasts?.at(-1)?.reason];}));
  let bucket=this.cache.get(code);if(!bucket||bucket.signature!==signature){bucket={signature,values:[]};this.cache.set(code,bucket);}
  const hit=bucket.values.find(v=>v.rows===options.historyRows&&v.target===options.targetDate&&v.validation===options.validation&&v.days===options.historyDays);if(hit)return hit.result;
  const result=forecastStats(code,records,options);bucket.values.unshift({rows:options.historyRows,target:options.targetDate,validation:options.validation,days:options.historyDays,result});bucket.values.length=Math.min(4,bucket.values.length);return result;
 }
}
