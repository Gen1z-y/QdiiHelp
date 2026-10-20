// Public index data is isolated from fund valuation and personal records.
import {session} from './calendar.mjs';
const closingSchedules={DJI:['America/New_York','16:00','US'],SPX:['America/New_York','16:00','US'],NDX:['America/New_York','16:00','US'],IXIC:['America/New_York','16:00','US'],FTSE:['Europe/London','16:35'],DAX:['Europe/Berlin','17:30'],CAC:['Europe/Paris','17:35'],SH:['Asia/Shanghai','15:00','CN'],SZ:['Asia/Shanghai','15:00','CN'],HSI:['Asia/Hong_Kong','16:10','HK'],N225:['Asia/Tokyo','15:30','JP']};
export function scheduledClose(id,date){
 const schedule=closingSchedules[id];if(!schedule||!date)return null;
 const [zone,regular,market]=schedule,half=market?session(date,market):null;
 const time=half?.closeHour===13?(market==='HK'?'12:10':'13:00'):regular;
 return {at:quoteTimestamp(date+' '+time+':00',zone),label:half?.closeHour===13?'半日市收盘参考':'常规收盘参考'};
}
export const marketDefinitions = [
  {id:'DJI',name:'道琼斯',region:'美国',secid:'100.DJIA',symbol:'usDJI',x:20,y:28},
  {id:'SPX',name:'标普500',region:'美国',secid:'100.SPX',symbol:'usINX',x:29,y:48},
  {id:'IXIC',name:'纳斯达克综合',region:'美国',secid:'100.NDX',symbol:'usIXIC',x:17,y:66},
  {id:'NDX',name:'纳斯达克100',region:'美国',symbol:'usNDX',x:29,y:88},
  {id:'FTSE',name:'英国富时100',region:'英国',secid:'100.FTSE',x:44,y:23},
  {id:'DAX',name:'德国DAX',region:'德国',secid:'100.GDAXI',x:57,y:43},
  {id:'CAC',name:'法国CAC40',region:'法国',secid:'100.FCHI',x:46,y:69},
  {id:'SH',name:'上证指数',region:'中国内地',secid:'1.000001',symbol:'sh000001',x:75,y:27},
  {id:'SZ',name:'深证成指',region:'中国内地',secid:'0.399001',symbol:'sz399001',x:73,y:75},
  {id:'HSI',name:'恒生指数',region:'中国香港',secid:'100.HSI',symbol:'hkHSI',x:84,y:54},
  {id:'N225',name:'日经225',region:'日本',secid:'100.N225',x:90,y:20}
];
const cache=new Map(),pending=new Map();
const historyCache=new Map(),quoteCache=new Map();
const sinaSymbols={FTSE:'b_FTSE',DAX:'b_DAX',CAC:'b_CAC',N225:'b_NKY'};
let sinaPending=null,tencentPending=null;
// A closed session's daily bars cannot change: cache them for hours and only
// keep refetching the cheap timestamped quote while a session is open.
export function sessionOpen(id,now=new Date()){
 const schedule=closingSchedules[id];if(!schedule)return false;
 const [zone,,market]=schedule;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 const date=parts.year+'-'+parts.month+'-'+parts.day,minute=Number(parts.hour)*60+Number(parts.minute);
 const opening=({FTSE:480,DAX:540,CAC:540,N225:540})[id]??570;
 const end=scheduledClose(id,date);if(!end)return false;
 const closedDay=market?session(date,market).closed:[0,6].includes(new Date(date+'T12:00:00Z').getUTCDay());
 return !closedDay&&minute>=opening&&now.getTime()<Date.parse(end.at);
}
export function quoteTimestamp(raw,zone){
 const text=raw.replaceAll('/','-').replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,'$1-$2-$3 $4:$5:$6');
 if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text))throw new Error('行情时间缺失');
 const target=Date.parse(text.replace(' ','T')+'Z');if(!Number.isFinite(target))throw new Error('行情时间无效');
 let utc=target;
 for(let i=0;i<3;i++){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(utc).map(p=>[p.type,p.value]));
  const local=Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  const delta=target-local;if(!delta)break;utc+=delta;
 }
 return new Date(utc).toISOString();
}
export function parseSinaQuote(text,spec){
 const symbol=sinaSymbols[spec.id],match=text.match(new RegExp('var hq_str_'+symbol+'="([^"]*)"'));
 const fields=match?.[1]?.split(',');
 if(!fields||fields.length<8)throw new Error('新浪报价缺少日期');
 const close=Number(fields[1]),change=Number(fields[3])/100;
 if(!(close>0)||!Number.isFinite(change)||!fields[3])throw new Error('新浪报价无效');
 // Sina timestamps are Beijing time; the session date belongs to the market.
 // European closing quotes may arrive after midnight in Beijing.
 const asOf=quoteTimestamp(fields[6]+' '+fields[7],'Asia/Shanghai');
 const zone=closingSchedules[spec.id][0];
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(asOf));
 return {date,close,change,asOf,timeZone:'Asia/Shanghai'};
}
export function parseTencentQuote(text,spec){
 const match=text.match(new RegExp('v_'+spec.symbol+'="([^"]*)"')),fields=match?.[1]?.split('~');
 if(!fields||fields[2]!==({usDJI:'.DJI',usINX:'.INX',usIXIC:'.IXIC',usNDX:'.NDX',sh000001:'000001',sz399001:'399001',hkHSI:'HSI'})[spec.symbol])throw new Error('腾讯指数代码不匹配');
 const close=Number(fields[3]),previous=Number(fields[4]);if(!(close>0&&previous>0))throw new Error('腾讯报价无效');
 const zone=spec.symbol.startsWith('us')?'America/New_York':'Asia/Shanghai',asOf=quoteTimestamp(fields[30],zone);
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(asOf));
 return {date,close,change:close/previous-1,asOf,timeZone:zone};
}
async function quoteText(url,referer){
 const r=await fetch(url,{signal:AbortSignal.timeout(9000),headers:{'User-Agent':'Mozilla/5.0',Referer:referer}});
 if(!r.ok)throw new Error('报价源暂不可用');return new TextDecoder('gb18030').decode(await r.arrayBuffer());
}
async function timedQuote(spec){
 if(sinaSymbols[spec.id]){
  if(!sinaPending)sinaPending=quoteText('https://hq.sinajs.cn/list='+Object.values(sinaSymbols).join(','),'https://finance.sina.com.cn/').finally(()=>{sinaPending=null;});
  return {source:'新浪财经 · 带时间报价',latest:parseSinaQuote(await sinaPending,spec)};
 }
 if(!tencentPending)tencentPending=quoteText('https://qt.gtimg.cn/q='+marketDefinitions.filter(s=>s.symbol).map(s=>s.symbol).join(','),'https://gu.qq.com/').finally(()=>{tencentPending=null;});
 return {source:'腾讯行情 · 带时间报价',latest:parseTencentQuote(await tencentPending,spec)};
}
let baiduPending=null;
export function parseBaiduOverview(j,spec){
  const result=j.Result?.[0]?.TplData?.result;
  const code=({SH:'000001',SZ:'399001',N225:'NK225'})[spec.id]??spec.id;
  const quote=result?.hot_index?.flatMap(g=>g.index_list??[]).find(q=>q.code===code);
  const pin=result?.index_map?.find(q=>q.code===code);
  const raw=quote?.px_change_rate??pin?.ratio;
  if(typeof raw!=='string'||!/^[-+]?\d+(\.\d+)?%$/.test(raw))throw new Error('百度指数行情不可用');
  const close=Number(quote?.last_px);
  return {source:'百度股市通 · 最新报价',rows:[],latest:{date:null,close:Number.isFinite(close)&&close>0?close:null,change:Number.parseFloat(raw)/100},historyError:'备用源仅提供最新报价，暂无可用历史日线'};
}
async function baiduIndex(spec){
  if(!baiduPending)baiduPending=json('https://finance.pae.baidu.com/vapi/index/overview').finally(()=>{baiduPending=null;});
  return parseBaiduOverview(await baiduPending,spec);
}
export function normalizeBars(rows){
  return [...new Map(rows.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isFinite(r.close)&&r.close>0).map(r=>[r.date,r])).values()].sort((a,b)=>a.date.localeCompare(b.date));
}
// A timestamped intraday quote must not be presented as a closing value.
export function closingValue(id,rows,latest,now=new Date()){
  const cutoff=Date.parse(now);
  const complete=normalizeBars(rows??[]).filter(r=>{
    const end=scheduledClose(id,r.date);
    if(!end||Date.parse(end.at)>cutoff)return false;
    return !(latest?.date===r.date&&latest.asOf&&Date.parse(latest.asOf)<Date.parse(end.at));
  });
  const last=complete.at(-1),previous=complete.at(-2);
  const end=scheduledClose(id,latest?.date);
  if(latest?.close>0&&latest.asOf&&end&&Date.parse(latest.asOf)>=Date.parse(end.at)&&Date.parse(latest.asOf)<=cutoff&&(!last||latest.date>=last.date))return latest;
  return last?{...last,change:previous?last.close/previous.close-1:null}:null;
}
async function json(url){
  const r=await fetch(url,{signal:AbortSignal.timeout(9000),headers:{'User-Agent':'Mozilla/5.0','Referer':'https://quote.eastmoney.com/'}});
  if(!r.ok)throw new Error('行情源暂不可用');return r.json();
}
async function fetchHistory(spec){
  try{
    if(!spec.secid)throw new Error('使用腾讯指数日线');
    const j=await json(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${spec.secid}&klt=101&fqt=0&lmt=260&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`);
    if(j.data?.code!==spec.secid.split('.')[1]||!j.data?.klines?.length)throw new Error('指数数据不可用');
    const rows=normalizeBars(j.data.klines.map(line=>{const r=line.split(',');return {date:r[0],close:Number(r[2])};}));
    if(rows.length<2)throw new Error('历史数据不足');
    return {source:'东方财富 · 指数日线',rows};
  }catch{
    if(!spec.symbol)throw new Error('行情源暂不可用，请稍后重试');
    const route=spec.symbol.startsWith('us')?'usfqkline':'fqkline';
    const j=await json(`https://web.ifzq.gtimg.cn/appstock/app/${route}/get?param=${spec.symbol},day,,,260,qfq`);
    const data=j.data?.[spec.symbol];
    if(!data?.day?.length)throw new Error('备用行情源暂不可用');
    const rows=normalizeBars(data.day.map(r=>({date:r[0],close:Number(r[2])})));
    if(rows.length<2)throw new Error('历史数据不足');
    return {source:'腾讯行情 · 指数日线',rows};
  }
}
export async function globalIndex(id,force=false){
  const spec=marketDefinitions.find(s=>s.id===id);if(!spec)throw new Error('不支持的指数');
  const old=cache.get(id);const nowMs=Date.now();
  if(!force&&old&&nowMs-Date.parse(old.fetchedAt)<(sessionOpen(id)?60000:600000))return old;
  if(pending.has(id))return pending.get(id);
  const task=(async()=>{try{
    const open=sessionOpen(id);
    const hOld=historyCache.get(id),qOld=quoteCache.get(id);
    const useHistory=!force&&hOld&&nowMs-Date.parse(hOld.fetchedAt)<(open?300000:6*3600000);
    const useQuote=!force&&qOld&&nowMs-Date.parse(qOld.fetchedAt)<60000;
    const fetchH=async()=>{if(useHistory)return hOld;const v=await fetchHistory(spec);historyCache.set(id,{...v,fetchedAt:new Date().toISOString()});return v;};
    const fetchQ=async()=>{if(useQuote)return qOld;const v=await timedQuote(spec);quoteCache.set(id,{...v,fetchedAt:new Date().toISOString()});return v;};
    const [history,quote]=await Promise.allSettled([fetchH(),fetchQ()]);
    let result;
    if(history.status==='fulfilled')result={...history.value,historySource:history.value.source};
    else if(quote.status==='fulfilled')result={rows:[],historyError:'最新报价可用，历史日线暂不可用'};
    else result=await baiduIndex(spec);
    const last=result.rows.at(-1),previous=result.rows.at(-2);
    let latest=result.latest??(last?{...last,change:last.close/previous.close-1}:null);
    if(quote.status==='fulfilled'&&(!latest?.date||quote.value.latest.date>=latest.date)){latest=quote.value.latest;result.source=quote.value.source;}
    if(!latest)throw new Error('指数报价不可用');
    if(!result.rows.length&&old?.rows?.length){result.rows=old.rows;result.historyError='历史日线更新失败，以下为缓存历史';}
    const value={...spec,...result,latest,closing:closingValue(id,result.rows,latest),scheduledClose:scheduledClose(id,latest.date),fetchedAt:new Date().toISOString(),stale:false};
    cache.set(id,value);return value;
  }catch(e){return {...(old??spec),stale:!!old,error:e.message};}})();
  pending.set(id,task);try{return await task;}finally{pending.delete(id);}
}
// Intraday selection is evaluated at request time, including cached responses.
export function marketDisplay(value,now=new Date()){
 const schedule=closingSchedules[value.id];
 if(!schedule)return {quote:null,label:'暂无数据',kind:'missing'};
 const [zone,,market]=schedule;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 const date=parts.year+'-'+parts.month+'-'+parts.day,minute=Number(parts.hour)*60+Number(parts.minute);
 const inSession=sessionOpen(value.id,now);
 const lunch=market==='CN'?minute>=690&&minute<780:market==='HK'?minute>=720&&minute<780:market==='JP'?minute>=690&&minute<750:false;
 const latest=value.latest,stamp=Date.parse(latest?.asOf);
 const latestDate=Number.isFinite(stamp)?new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(stamp):null;
 const age=now.getTime()-stamp;
 // Never call an old, failed, future or untimestamped quote realtime.
 if(inSession&&latest?.close>0&&latestDate===date&&age>=0){
  const fresh=!value.stale&&age<=120000;
  return {quote:latest,kind:lunch?'break':fresh?'live':'delayed',label:lunch?'午间休市':fresh?'实时行情':'报价有延迟',pointLabel:'最新点数'};
 }
 const closing=closingValue(value.id,value.rows,latest,now)??value.closing;
 if(closing)return {quote:closing,kind:inSession?'delayed':'closed',label:inSession?'等最新报价':'收盘行情',pointLabel:'收盘点数'};
 return {quote:null,kind:'missing',label:inSession?'等最新报价':'收盘价待更新',pointLabel:'暂无确认数据'};
}
export async function globalMarkets(force=false,onProgress=()=>{}){
 let completed=0;const total=marketDefinitions.length;
 onProgress({completed,total});
 return {items:await Promise.all(marketDefinitions.map(async spec=>{
  const data=await globalIndex(spec.id,force),item={...data,display:marketDisplay(data)};
  onProgress({completed:++completed,total,item});return item;
 }))};
}
