import {isDeepStrictEqual} from 'node:util';
import {forecastStats} from './forecast-stats.mjs';
import {evidenceStats} from './model-evidence.mjs';
import {forecastHistory} from './holiday-export.mjs';
import {navEstimate} from './nav-observation.mjs';
import {shiftDate} from './calendar.mjs';
import {chinaDate} from './model.mjs';

// Results and original timestamps remain permanent; only detailed inputs expire.
export const RETENTION_DAYS=180;
const pick=(value,keys)=>value==null?value:Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
function forecastSummary(value){
 if(!value)return value;
 return {...pick(value,['date','asOf','base','model','holdingsDate','calculatedAt']),detailsOmitted:true};
}
function compactRecord(record,now){
 const next={...record,detailsCompactedAt:now.toISOString()};
 for(const key of ['forecast','partialForecast','originalForecast'])if(record[key])next[key]=forecastSummary(record[key]);
 if(record.evidence)next.evidence=record.evidence.map(e=>({
  ...pick(e,['schema','date','base','calculatedAt','capturedAt','holdingVersion','holdingsDate','fingerprint','model','holdingSource']),
  ...(e.candidate?{candidate:pick(e.candidate,['method','return','dailyReturn','value','experimental'])}:{}),detailsOmitted:true
 }));
 if(record.rejectedForecasts)next.rejectedForecasts=record.rejectedForecasts.map(r=>({...r,forecast:forecastSummary(r.forecast)}));
 return next;
}
function observable(key,record){
 const code=key.slice(0,6),records={[key]:record};
 return {stats:forecastStats(code,records),evidence:evidenceStats(records,code),history:forecastHistory(records,code),nav:navEstimate({date:key.slice(7),record})};
}
export function pruneOldObservations(data,{days=RETENTION_DAYS,now=new Date()}={}){
 const cutoff=shiftDate(chinaDate(now),-days);
 const replacements=[];
 // Validate all summaries before mutation; keep evidence order and timestamps.
 for(const [key,record] of Object.entries(data.records??{}))if(key.slice(7)<cutoff&&!record.detailsCompactedAt){
  const next=compactRecord(record,now);
  if(!isDeepStrictEqual(observable(key,record),observable(key,next)))throw new Error('历史摘要核对失败，保留完整明细：'+key);
  replacements.push([key,next]);
 }
 for(const [key,record] of replacements)data.records[key]=record;
 let removed=replacements.length;
 for(const key of Object.keys(data.lastView??{}))if(key.slice(7)<cutoff){delete data.lastView[key];removed++;}
 for(const date of Object.keys(data.fxDisplay??{}))if(date<cutoff){delete data.fxDisplay[date];removed++;}
 return removed;
}
export function hasOldObservations(data,{days=RETENTION_DAYS,now=new Date()}={}){
 const cutoff=shiftDate(chinaDate(now),-days);
 return Object.entries(data.records??{}).some(([key,r])=>key.slice(7)<cutoff&&!r.detailsCompactedAt)
  ||Object.keys(data.lastView??{}).some(key=>key.slice(7)<cutoff)
  ||Object.keys(data.fxDisplay??{}).some(date=>date<cutoff);
}
