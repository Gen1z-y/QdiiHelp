import {session} from './calendar.mjs';
import {chinaDate} from './model.mjs';
import {previousNavDate} from './nav-observation.mjs';

const endpoint='https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/RtimeYldCurv';
const types={government:'100101',cdb:'230101',eib:'230102',adbc:'230103',paper:'260101',mtn:'270101'};
const terms=[.5,1,2,3,5,7,10,20,30];
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
const chinaTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

export function bondCurveTime(target,now){
 const time=chinaTime.format(now),day=session(target,'CN');
 if(target!==chinaDate(now)||day.closed||!day.known||time<'09:32'||time>'17:15')return null;
 if(time>='17:02')return '17:00';
 const m=minute(time)-2;
 return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
}

export function parseBondCurve(payload,date,time){
 const data=payload?.data;
 if(payload?.head?.rep_code!=='200'||data?.date!==date||data.time!==time||!Array.isArray(data.data))return null;
 const benchmarks=Array.isArray(data.dataterms?.[0])?data.dataterms[0].filter(Number.isFinite):[];
 if(!benchmarks.length)return null;
 const low=Math.min(...benchmarks),high=Math.max(...benchmarks),values={};
 for(const row of data.data){
  if(!Array.isArray(row))continue;
  const term=Number(row[3]),bid=Number(row[5]),mid=Number(row[6]),ask=Number(row[7]);
  if(!terms.includes(term)||!row[5]||!row[6]||!row[7]||![bid,mid,ask].every(Number.isFinite)||mid<=0||mid>=25||bid<mid||mid<ask||bid-ask>.2)continue;
  // The official chart's 30Y value is tied to the quoted 30Y benchmark.
  if(term!==30&&(term<low||term>high))continue;
  if(term===30&&!payload.records?.some(r=>Number(r.tl)===30&&Number.isFinite(r.avgYield)))continue;
  values[term]=mid/100;
 }
 return Object.keys(values).length?values:null;
}

const cache=new Map();
let baseDay;
export async function loadBondCurves(target,time,fetcher=fetch){
 const previous=previousNavDate(target);
 if(previous!==baseDay){cache.clear();baseDay=previous;}
 async function get(bondType,date,qttntime){
  const load=async()=>{
   const url=new URL(endpoint);
   for(const [key,value] of Object.entries({lang:'CN',qttndate:date,qttntime,bondType}))url.searchParams.set(key,value);
   try{
    const response=await fetcher(url,{signal:AbortSignal.timeout(4500)});
    return response.ok?parseBondCurve(await response.json(),date,qttntime):null;
   }catch{return null;}
  };
  if(date===target)return load();
  if(!cache.has(bondType))cache.set(bondType,load());
  const task=cache.get(bondType),result=await task;
  if(!result&&cache.get(bondType)===task)cache.delete(bondType);
  return result;
 }
 return Object.fromEntries(await Promise.all(Object.entries(types).map(async ([kind,type])=>{
  const [base,current]=await Promise.all([get(type,previous,'17:00'),get(type,target,time)]);
  return [kind,base&&current?Object.fromEntries(terms.filter(term=>Number.isFinite(base[term])&&Number.isFinite(current[term])).map(term=>[term,current[term]-base[term]])):{}];
 })));
}
