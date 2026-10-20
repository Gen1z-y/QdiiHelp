import {marketStatus,quoteDateMatches} from './calendar.mjs';
import {previousWeekday} from './model.mjs';
const definitions={IXIC:{symbol:'usIXIC',ticker:'.IXIC',name:'纳斯达克综合'},NDX:{symbol:'usNDX',ticker:'.NDX',name:'纳斯达克100'},SPX:{symbol:'usINX',ticker:'.INX',name:'标普500'}};
export function estimateIndex(date,base,indexQuote,fx){
 const dailyReturn=(1+indexQuote.dailyReturn)*(1+fx.return)-1;
 return {date,base,indexQuote,fx,calculatedAt:new Date().toISOString(),
  model:{method:'index-proxy-v1',return:dailyReturn,value:base.value*(1+dailyReturn),coverage:100},
  assumption:'按100%美元价格指数敞口与人民币汇率估算；未计现金仓位、分红、费用、跟踪误差及汇率对冲'};
}
export function indexForFund(name){
 if(/等权|杠杆|反向|低波|红利|科技|生物/.test(name))return null;
 if(/纳斯达克\s*100|纳指\s*100|NASDAQ\s*100/i.test(name))return 'NDX';
 if(/标普\s*500|S&P\s*500/i.test(name))return 'SPX';
 return null;
}
export function selectIndexClose(rows,targetDate,now=new Date()){
 const complete=rows.filter(r=>r.close>0&&r.date<=targetDate&&marketStatus(r.date,'US',now).state==='complete').sort((a,b)=>a.date.localeCompare(b.date));
 if(complete.length<2)throw new Error('缺少已完成交易日的指数收盘数据');
 const current=complete.at(-1),previous=complete.at(-2);
 return {date:current.date,previousDate:previous.date,close:current.close,previousClose:previous.close,dailyReturn:current.close/previous.close-1};
}
const cache=new Map(),pending=new Map(),seriesCache=new Map(),seriesPending=new Map();
export async function clearIndexCache(){await Promise.allSettled([...pending.values(),...seriesPending.values()]);cache.clear();seriesCache.clear();}
async function indexSeries(id,spec){
 const old=seriesCache.get(id);if(old&&Date.now()-old.time<60000)return old.value;
 if(seriesPending.has(id))return seriesPending.get(id);
 const task=(async()=>{
  const response=await fetch(`https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param=${spec.symbol},day,,,96,qfq`,{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('指数行情源暂不可用');
  const json=await response.json(),data=json.data?.[spec.symbol];
  if(data?.qt?.[spec.symbol]?.[2]!==spec.ticker||!Array.isArray(data.day))throw new Error('指数身份或数据格式校验失败');
  seriesCache.set(id,{time:Date.now(),value:data});return data;
 })().finally(()=>seriesPending.delete(id));seriesPending.set(id,task);return task;
}
export async function indexClose(id,date,baseDate=null){
 const spec=definitions[id];if(!spec)throw new Error('不支持的指数');
 const key=id+':'+date+':'+baseDate,old=cache.get(key);if(old&&Date.now()-old.time<60000)return old.value;
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{
  const data=await indexSeries(id,spec);
  const value={id,name:spec.name,currency:'USD',source:'腾讯行情 · 指数日收盘',...selectIndexClose(data.day.map(r=>({date:r[0],close:Number(r[2])})),date),checkedAt:new Date().toISOString()};
  value.marketStatus=marketStatus(date,'US');
  if(value.marketStatus.state==='pending')throw new Error(value.marketStatus.message);
  if(!quoteDateMatches(value.date,date,'US'))throw new Error('缺少应有交易日的指数收盘行情');
  value.valuationPreviousDate=previousWeekday(new Date(date+'T12:00:00Z'));
  const dailyBar=data.day.filter(r=>r[0]<=value.valuationPreviousDate&&Number(r[2])>0).sort((a,b)=>a[0].localeCompare(b[0])).at(-1);
  if(!dailyBar||!quoteDateMatches(dailyBar[0],value.valuationPreviousDate,'US'))throw new Error('缺少指数单日基准行情');
  value.valuationPreviousQuoteDate=dailyBar[0];value.valuationPreviousClose=Number(dailyBar[2]);
  if(baseDate){const bar=data.day.filter(r=>r[0]<=baseDate&&Number(r[2])>0).sort((a,b)=>a[0].localeCompare(b[0])).at(-1);if(!bar)throw new Error('指数缺少净值基准日收盘');value.baseDate=bar[0];value.baseClose=Number(bar[2]);}
  cache.set(key,{value,time:Date.now()});return value;
 })();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
}
export function estimateMarketIndex(date,base,indexQuote,fx,dailyFx){
 const total=(indexQuote.close/indexQuote.baseClose)*(1+fx.return)-1;
 const v3=Number.isFinite(indexQuote.valuationPreviousClose);
 const daily=(v3?indexQuote.close/indexQuote.valuationPreviousClose:1+indexQuote.dailyReturn)*(1+dailyFx.return)-1;
 return {date,base,indexQuote,fx,dailyFx,calculatedAt:new Date().toISOString(),model:{method:v3?'index-proxy-v3':'index-proxy-v2',return:total,dailyReturn:daily,value:base.value*(1+total),coverage:100}};
}
