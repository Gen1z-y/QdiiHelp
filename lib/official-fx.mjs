import {chinaDate,validDate} from './model.mjs';
import {readQuoteCache,writeQuoteCache} from './quote-cache.mjs';

export const OFFICIAL_FX_URL='https://www.chinamoney.com.cn/chinese/bkccpr/';
const SOURCE='中国外汇交易中心 · 人民币中间价';
const DAY=86400000;
export function isOfficialFx(value){
 return value?.authority==='CFETS'&&value.sourceUrl===OFFICIAL_FX_URL&&validDate(value.date)&&validDate(value.closeDate)&&validDate(value.previousDate)&&
  value.previousDate<value.closeDate&&value.closeDate<=value.date&&Date.parse(value.date)-Date.parse(value.closeDate)<=14*DAY&&
  Number.isFinite(value.close)&&value.close>0&&Number.isFinite(value.previousClose)&&value.previousClose>0&&
  Number.isFinite(value.dailyReturn)&&Math.abs(value.dailyReturn-(value.close/value.previousClose-1))<1e-12;
}
export function parseOfficialFixings(payload,date){
 if(!validDate(date))throw Error('官方汇率查询日期无效');
 if(String(payload?.head?.rep_code)!=='200'||payload.data?.currency!=='USD/CNY'||!Array.isArray(payload.records))throw Error('官方汇率响应格式异常');
 const rows=new Map();
 for(const row of payload.records){
  if(!validDate(row.date)||!Array.isArray(row.values)||row.values.length!==1||!/^\d+(?:\.\d+)?$/.test(String(row.values[0]))||!(Number(row.values[0])>0))throw Error('官方汇率记录异常');
  if(row.date>date)continue;
  const close=Number(row.values[0]);
  if(!Number.isFinite(close)||rows.has(row.date)&&rows.get(row.date)!==close)throw Error('官方汇率记录冲突');
  rows.set(row.date,close);
 }
 const [target,base]=[...rows].sort((a,b)=>b[0].localeCompare(a[0]));
 if(!target||!base||Date.parse(date)-Date.parse(target[0])>14*DAY)throw Error('官方汇率缺少近期连续公布数据');
 return {date,closeDate:target[0],close:target[1],previousDate:base[0],previousClose:base[1],dailyReturn:target[1]/base[1]-1,
  carried:target[0]!==date,source:SOURCE,authority:'CFETS',sourceUrl:OFFICIAL_FX_URL};
}
// Homepage reference only; fund valuation providers and sealed forecasts are separate.
export async function officialFxSummary(date,{fetcher=globalThis.fetch}={}){
 if(!validDate(date)||date>chinaDate())throw Error('官方汇率查询日期无效');
 const key='official-usdcny-v1:'+date,ttl=date<chinaDate()?DAY:240000;
 const saved=readQuoteCache(key,ttl)?.data;
 if(isOfficialFx(saved)&&saved.date===date)return saved;
 const start=new Date(date+'T12:00:00Z');start.setUTCDate(start.getUTCDate()-45);
 const url=new URL('https://www.chinamoney.com.cn/ags/ms/cm-u-bk-ccpr/CcprHisNew');
 url.search=new URLSearchParams({startDate:start.toISOString().slice(0,10),endDate:date,currency:'USD/CNY',pageNum:'1',pageSize:'60'}).toString();
 const response=await fetcher(url.href,{headers:{Referer:OFFICIAL_FX_URL,'User-Agent':'Mozilla/5.0 QdiiHelp/1.0'},signal:AbortSignal.timeout(14000)});
 if(!response.ok)throw Error('官方汇率接口返回 HTTP '+response.status);
 const result={...parseOfficialFixings(JSON.parse(await response.text()),date),savedAt:new Date().toISOString()};
 writeQuoteCache(key,result);return result;
}
