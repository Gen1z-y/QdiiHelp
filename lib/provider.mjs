import {movement,chinaDate,previousWeekday} from './model.mjs';
import {marketId,marketStatus,canUseBar,quoteDateMatches,expectedCloseDate,shiftDate} from './calendar.mjs';
import {readQuoteCache,writeQuoteCache,clearQuoteCache,hedged} from './quote-cache.mjs';
const headers={Referer:'https://fundf10.eastmoney.com/','User-Agent':'Mozilla/5.0 QdiiHelp/1.0'};
const cache=new Map();
const pending=new Map();
let eastmoneyBlockedUntil=0;
// A session confirmed complete (and any past CN date for the fixing) cannot
// change anymore, so its quotes stay valid for a day instead of four minutes.
const RECENT_TTL=240000,SETTLED_TTL=86400000;
const stockTtl=(secid,date,now)=>marketStatus(date,marketId(secid),now).state==='complete'?SETTLED_TTL:RECENT_TTL;
const fxTtl=date=>date<chinaDate()?SETTLED_TTL:RECENT_TTL;
export async function clearProviderCache(){
  await Promise.allSettled([...pending.values()]);
  cache.clear();clearQuoteCache();eastmoneyBlockedUntil=0;
}
async function get(url,ttl=240000) {
  const persistent=/api\.frankfurter/.test(url);
  const c=cache.get(url); if(c && Date.now()-c.time<ttl) return c.data;
  if(persistent){const saved=readQuoteCache(url,ttl);if(saved){cache.set(url,saved);return saved.data;}}
  if(pending.has(url))return pending.get(url);
  const task=(async()=>{
    const disclosure=/FundArchivesDatas\.aspx|\/pingzhongdata\//.test(url);
    for(let attempt=0;;attempt++)try{
      const r=await fetch(url,{headers,signal:AbortSignal.timeout(14000)});
      if(!r.ok) throw new Error('数据源返回 HTTP '+r.status);
      const data=await r.text(); cache.set(url,{time:Date.now(),data});if(persistent)writeQuoteCache(url,data); return data;
    }catch(e){
      const transient=/fetch failed|HTTP (429|514|503)|timeout|timed out/i.test(e.message)||e.name==='TimeoutError';
      if(disclosure&&transient&&attempt<2){await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));continue;}
      if(disclosure){const stage=url.includes('pingzhongdata')?'基金资料接口':'披露持仓接口';throw new Error(stage+'请求失败：'+e.message+(e.cause?.code?'（'+e.cause.code+'）':''),{cause:e});}
      throw e;
    }
  })();pending.set(url,task);try{return await task;}finally{pending.delete(url);}
}
const clean=s=>s.replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim();
export function parseHoldings(text) {
  const literal=text.match(/content:\s*("(?:\\.|[^"\\])*")/);
  if(!literal) throw new Error('持仓数据格式发生变化');
  const html=JSON.parse(literal[1]),body=html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  const asOf=html.match(/截止至：[\s\S]*?(\d{4}-\d{2}-\d{2})/)?.[1];
  const name=html.match(/title=['"]([^'"]+)['"]/)?.[1];
  if(!body || !asOf || !name) throw new Error('暂无可用股票持仓披露（暂不支持无股票持仓的基金）');
  const rows=[...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m=>{
    const cells=[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(x=>x[1]);
    const w=cells.map(clean).find(x=>/^\d+(\.\d+)?%$/.test(x));
    return {code:clean(cells[1]??''),name:clean(cells[2]??''),weight:parseFloat(w),secid:m[1].match(/unify\/r\/([\w.]+)/)?.[1]??null};
  }).filter(r=>r.code && Number.isFinite(r.weight));
  if(!rows.length) throw new Error('没有解析到持仓');
  const total=rows.reduce((s,r)=>s+r.weight,0);
  if(total>100.5||rows.some(r=>r.weight<0))throw new Error('披露权重异常，已拒绝用于估算');
  return {name,asOf,rows};
}
export async function holdings(code,{force=false,onStage=()=>{}}={}) {
  onStage('获取最新披露日期与重仓股');
  let result=parseHoldings(await get(`https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=&month=`,force?0:3600000));
  if(/美元|港币|现钞|现汇/.test(result.name))throw new Error('本版仅支持人民币净值份额');
  // The endpoint caps the default latest-period query at ten even with topline=1000.
  // An explicit period is necessary; never substitute an older report silently.
  try{
    onStage('获取 '+result.asOf+' 完整披露持仓');
    const expanded=parseHoldings(await get(`https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=1000&year=${result.asOf.slice(0,4)}&month=${Number(result.asOf.slice(5,7))}`,force?0:3600000));
    if(expanded.asOf!==result.asOf)throw new Error('完整明细日期与最新披露不一致');
    if(expanded.rows.length<result.rows.length)throw new Error('完整明细缺少已披露重仓项');
    result={...expanded,expanded:true};
  }catch(e){result={...result,expanded:false,expansionError:e.message};}
  result.source='东方财富 · '+(result.expanded?'指定报告期全部可获取披露股票':'重仓股票（完整明细获取失败）');
  return result;
}
export async function fundProfile(code,{force=false}={}) {
  const text=await get(`https://fund.eastmoney.com/pingzhongdata/${code}.js`,force?0:3600000);
  const literal=text.match(/var\s+fS_name\s*=\s*("(?:\\.|[^"\\])*")/);
  if(!literal)throw new Error('未能获取基金名称');
  const name=JSON.parse(literal[1]);
  if(/美元|港币|现钞|现汇/.test(name))throw new Error('目前仅支持人民币份额');
  return {name,bond:/债/.test(name),allocation:parseAllocation(text)};
}
export function parseAllocation(text){
 try{
  const literal=text.match(/var\s+Data_assetAllocation\s*=\s*([^;]+);/)?.[1];if(!literal)return null;
  const data=JSON.parse(literal),i=data.categories.length-1,date=data.categories[i];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const getValue=name=>{const value=data.series.find(s=>s.name===name)?.data?.[i];return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;};
  return {date,stock:getValue('股票占净比'),bond:getValue('债券占净比'),cash:getValue('现金占净比'),source:'天天基金披露资产配置'};
 }catch{return null;}
}
export async function navs(code,fresh=false) {
  const j=JSON.parse(await get(`https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=120`,fresh?0:60000));
  const rows=j.Data?.LSJZList;
  if(!Array.isArray(rows)||!rows.length) throw new Error('未获取到正式净值，请检查基金代码');
  return rows.map(r=>({date:r.FSRQ,value:Number(r.DWJZ),dailyReturn:r.JZZZL==null||r.JZZZL===''||!Number.isFinite(Number(r.JZZZL))?null:Number(r.JZZZL)/100})).filter(r=>r.value>0).sort((a,b)=>b.date.localeCompare(a.date));
}
// Independent second opinion on the latest published NAV (Tencent fund quote).
// Returns null when the sources are not comparable; never throws.
export async function navCrossCheck(code,rows){
 if(!rows?.length)return null;
 let text;try{text=await get(`https://qt.gtimg.cn/q=jj${code}`,300000);}catch{return null;}
 const parts=text.split('"')[1]?.split('~');
 const date=parts?.[8];
 if(!parts||!/^\d{4}-\d{2}-\d{2}$/.test(date??''))return null;
 const other={date,value:Number(parts[5]),dailyReturn:Number(parts[7])/100};
 const mine=rows.find(r=>r.date===date);
 if(!mine||!Number.isFinite(other.value)||!Number.isFinite(mine.value))return null;
 if(Math.abs(other.value-mine.value)/mine.value>0.005)return {ok:false,reason:'净值交叉校验不一致：另一源 '+date+' 单位净值 '+other.value+'，本源 '+mine.value};
 if(Number.isFinite(other.dailyReturn)&&Number.isFinite(mine.dailyReturn)&&Math.abs(other.dailyReturn-mine.dailyReturn)>0.0005)return {ok:false,reason:'净值交叉校验不一致：另一源 '+date+' 涨跌 '+(other.dailyReturn*100).toFixed(2)+'%，本源 '+(mine.dailyReturn*100).toFixed(2)+'%'};
 return {ok:true};
}
const known={'000660':'177.000660','005930':'177.005930','285A':'176.285A'};
const markets={'105':['美国','USD','America/New_York',16], '106':['美国','USD','America/New_York',16], '107':['美国','USD','America/New_York',16], '116':['香港','HKD','Asia/Hong_Kong',16], '177':['韩国','KRW','Asia/Seoul',16], '176':['日本','JPY','Asia/Tokyo',16], '0':['中国内地','CNY','Asia/Shanghai',15], '1':['中国内地','CNY','Asia/Shanghai',15]};
const fxIds={USD:['120.USDCNYC',false],HKD:['120.HKDCNYC',false],JPY:['120.JPYCNYC',false],KRW:['120.CNYKRWC',true]};
export async function resolve(row) {
  if(row.secid) return row.secid;
  if(known[row.code]) return known[row.code];
  const j=JSON.parse(await get(`https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(row.code)}&type=14&count=10`,86400000));
  const hits=(j.QuotationCodeTable?.Data??[]).filter(x=>x.Code===row.code && markets[x.MktNum]);
  return hits.length===1?hits[0].QuoteID:null;
}
export async function bars(secid,date,ttl=RECENT_TTL) {
  const url=`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&klt=101&fqt=1&lmt=96&end=${date.replaceAll('-','')}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
  if(Date.now()<eastmoneyBlockedUntil) throw new Error('东方财富行情暂不可用');
  let j;try {j=JSON.parse(await get(url,ttl));}catch(e){eastmoneyBlockedUntil=Date.now()+300000;throw e;}
  if(!j.data?.klines?.length) throw new Error('暂无收盘行情');
  return j.data.klines.map(s=>{const a=s.split(',');return {date:a[0],close:Number(a[2]),dayReturn:Number(a[8])/100};});
}
function withDayReturn(rows) {
 return rows.sort((a,b)=>a.date.localeCompare(b.date)).map((r,i,all)=>({...r,dayReturn:i?r.close/all[i-1].close-1:null}));
}
// The eastmoney kline endpoint serves no bars at all for the SH treasury index
// (empty response), Sina serves stale series for the corporate/convertible
// indices, and Tencent occasionally answers with a WAF page — so each bond
// index walks a per-symbol source chain and rejects any series whose latest
// bar is not fresh relative to the target date.
export async function bondBars(symbol,date,ttl=RECENT_TTL) {
 const key='sh'+symbol;
 // A confirmed CN session cannot change anymore: keep its series for a day.
 const eff=marketStatus(date,'CN').state==='complete'?SETTLED_TTL:ttl;
 const clean=rows=>rows.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date??'')&&Number.isFinite(r.close)&&r.close>0&&r.date<=date);
 const sources=[
  async()=>{
   const t=await get(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${key},day,,,320,qfq`,eff).then(s=>JSON.parse(s)).catch(()=>null);
   return (t?.data?.[key]?.day??t?.data?.[key]?.qfqday??[]).filter(r=>Array.isArray(r)&&r.length>=3).map(r=>({date:r[0],close:Number(r[2])}));
  },
  async()=>{
   const j=await get(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.${symbol}&klt=101&fqt=1&lmt=320&end=${date.replaceAll('-','')}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`,eff).then(s=>JSON.parse(s)).catch(()=>null);
   return (j?.data?.klines??[]).map(s=>{const a=s.split(',');return {date:a[0],close:Number(a[2])};});
  },
  async()=>{
   const s=await get(`https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${key}&scale=240&ma=no&datalen=320`,eff).then(s=>JSON.parse(s)).catch(()=>null);
   return (Array.isArray(s)?s:[]).map(r=>({date:r.day,close:Number(r.close)}));
  },
 ];
 const freshAfter=expectedCloseDate(shiftDate(date,-10),'CN');
 const cacheKey=`bondseries:${symbol}`;
 const finish=rows=>{const done=withDayReturn(rows);writeQuoteCache(cacheKey,done);return done;};
 let best=null;
 for(const source of sources){
  let rows=[];try{rows=clean(await source());}catch{continue;}
  if(!rows.length||rows.at(-1).date<freshAfter)continue;
  if(rows.at(-1).date===date)return finish(rows);
  best??=rows;
 }
 // Intraday, some sources lag behind the session: synthesize today's bar from
 // the eastmoney realtime quote, validated by its own timestamp.
 if(best){
  const q=await get(`https://push2.eastmoney.com/api/qt/stock/get?secid=1.${symbol}&fields=f43,f60,f86`,eff).then(s=>JSON.parse(s)).catch(()=>null);
  const d=q?.data;
  if(d&&Number.isFinite(d.f43)&&Number.isFinite(d.f60)&&d.f60>0&&Number.isFinite(d.f86)){
   const qDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d.f86*1000));
   if(qDate===date)return finish([...best,{date,close:d.f43/100}]);
  }
  return finish(best);
 }
 // Every source failed (rate limits, WAF): fall back to the last good series so
 // the reference degrades to a clearly labelled carried value instead of blank.
 const saved=readQuoteCache(cacheKey,7*86400000);
 if(saved?.data?.length)return saved.data.filter(r=>r.date<=date);
 throw new Error('债券指数行情暂不可用');
}
// Disclosed top bond positions: context for the fitted sensitivities, never a
// model input (disclosed bonds carry no duration or valuation data).
export async function bondHoldings(code,{force=false}={}) {
 const text=await get(`https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=zqcc&code=${code}&topline=5`,force?0:3600000);
 const literal=text.match(/content:\s*("(?:\\.|[^"\\])*")/);
 if(!literal)throw new Error('暂无披露债券持仓');
 const html=JSON.parse(literal[1]);
 const asOf=html.match(/截止至：<font[^>]*>(\d{4}-\d{2}-\d{2})<\/font>/)?.[1]??html.match(/截止至：[\s\S]*?(\d{4}-\d{2}-\d{2})/)?.[1];
 const body=html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
 if(!asOf||!body)throw new Error('暂无披露债券持仓');
 const rows=[...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m=>{
  const cells=[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(x=>clean(x[1]));
  const w=cells.find(x=>/^\d+(\.\d+)?%$/.test(x));
  return {code:cells[1]??'',name:cells[2]??'',weight:parseFloat(w)};
 }).filter(r=>r.code&&Number.isFinite(r.weight));
 if(!rows.length)throw new Error('暂无披露债券持仓');
 return {asOf,rows,source:'天天基金披露债券投资明细'};
}
async function stockBars(secid,date,baseDate,now) {
 const validate=quote=>{const market=markets[secid.split('.')[0]],id=marketId(secid),series=completedBars(quote.rows,market,now),move=movement(series,baseDate,date),daily=movement(series,previousWeekday(new Date(date+'T12:00:00Z')),date);if(!move||!daily||!canUseBar(move.target,date,id,now)||!quoteDateMatches(move.base.date,baseDate,id)||!quoteDateMatches(daily.base.date,previousWeekday(new Date(date+'T12:00:00Z')),id))throw new Error('缺少应有交易日行情');
  // Data-error sentinel: a single bar moving far beyond market limits inside
  // the window usually means a broken adjustment, not a real session.
  const cap=id==='CN'?0.22:0.6;
  for(const bar of series)if(bar.date>move.base.date&&bar.date<=move.target.date&&Number.isFinite(bar.dayReturn)&&Math.abs(bar.dayReturn)>cap)throw new Error('行情单日变动异常（'+bar.date+' '+(bar.dayReturn*100).toFixed(1)+'%），未计入预估');
  return quote;};
 const ttl=stockTtl(secid,date,now);
 // Keyed by session only: the 96-bar series serves any base date inside its
 // window, and validate() re-checks the requested base on every read.
 const key=`stock:${secid}:${date}`,saved=readQuoteCache(key,ttl);
 if(saved){try{return validate(saved.data);}catch{}}
 const quote=await hedged(async()=>validate({rows:await bars(secid,date,ttl),source:'东方财富 · 前复权'}),async()=>validate(await backupStockBars(secid,date,ttl)));
 writeQuoteCache(key,quote);return quote;
}
async function backupStockBars(secid,date,ttl=RECENT_TTL) {
  const [m,code]=secid.split('.');
  if(m==='177') {
    const xml=await get(`https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=120&requestType=0`,ttl);
    const rows=[...xml.matchAll(/<item data="([^"]+)"/g)].map(x=>{const a=x[1].split('|');return {date:a[0].slice(0,4)+'-'+a[0].slice(4,6)+'-'+a[0].slice(6,8),close:Number(a[4])};}).filter(r=>r.date<=date&&r.close>0);
    if(!rows.length)throw new Error('韩股备用行情暂无数据');
    return {rows:withDayReturn(rows),source:'NAVER · 日收盘（复权口径未确认）'};
  }
  let symbol,endpoint='fqkline';
  if(m==='105'||m==='106'){symbol=`us${code}.${m==='105'?'OQ':'N'}`;endpoint='usfqkline';}
  else if(m==='116')symbol='hk'+code;
  else if(m==='0'||m==='1')symbol=(m==='0'?'sz':'sh')+code;
  else throw new Error('主行情源断连，此市场尚无备用源');
  // Tencent's dated US endpoint can omit the latest completed session.
  // Fetch the recent series and apply the requested local trading date ourselves.
  const j=JSON.parse(await get(`https://web.ifzq.gtimg.cn/appstock/app/${endpoint}/get?param=${symbol},day,,,96,qfq`,ttl));
  const data=j.data?.[symbol],raw=data?.qfqday??data?.day;
  if(!raw?.length)throw new Error('备用行情无匹配数据');
  return {rows:withDayReturn(raw.map(a=>({date:a[0],close:Number(a[2])})).filter(r=>r.date<=date&&r.close>0)),source:'腾讯行情 · '+(data.qfqday?'前复权':'日收盘')};
}
let fxStorage=null;
const fxPending=new Map();
export function configureFxStorage(storage){fxStorage=storage;}
export async function fxMovement(currency,baseDate,targetDate) {
 const snapshotKey=`${currency}:${baseDate}:${targetDate}`;
 const fixed=fxStorage?.read(snapshotKey);if(fixed&&usableFx(fixed,baseDate,targetDate))return fixed;
 if(fxPending.has(snapshotKey))return fxPending.get(snapshotKey);
 const task=loadFxMovement(currency,baseDate,targetDate).then(result=>{if(usableFx(result,baseDate,targetDate))fxStorage?.write(snapshotKey,result);return result;}).finally(()=>fxPending.delete(snapshotKey));
 fxPending.set(snapshotKey,task);return task;
}
async function loadFxMovement(currency,baseDate,targetDate) {
 const ttl=fxTtl(targetDate);
 const key=`fx:${currency}:${baseDate}:${targetDate}`,saved=readQuoteCache(key,ttl);
 if(saved&&saved.data.source==='人民币中间价'&&usableFx(saved.data,baseDate,targetDate))return saved.data;
 const result=await fetchFxMovement(currency,baseDate,targetDate,ttl);
 if(usableFx(result,baseDate,targetDate))writeQuoteCache(key,result);
 return result;
}
async function fetchFxMovement(currency,baseDate,targetDate,ttl=RECENT_TTL) {
  const spec=fxIds[currency];
  let reference;
  const primary=async()=>{const result=movement(await bars(spec[0],targetDate,ttl),baseDate,targetDate,spec[1]);if(result){reference={...result,source:'人民币中间价'};if(result.target.date===targetDate&&result.base.date===baseDate)return reference;}throw new Error('主汇率缺少对应日期');};
  // Finish the valuation-date fixing request before using another authority.
  // A faster ECB response must never beat a valid Chinese fixing.
  try{return await primary();}catch{if(reference&&usableFx(reference,baseDate,targetDate))return reference;}
  try{
  const start=new Date(baseDate);start.setUTCDate(start.getUTCDate()-10);
  let j;try{j=JSON.parse(await get(`https://api.frankfurter.dev/v1/${start.toISOString().slice(0,10)}..${targetDate}?base=CNY&symbols=USD,HKD,JPY,KRW`,ttl));}catch(e){if(reference&&usableFx(reference,baseDate,targetDate))return reference;throw e;}
  const rows=Object.entries(j.rates??{}).map(([date,rates])=>({date,close:1/rates[currency]})).filter(r=>r.close>0);
  const result=movement(rows,baseDate,targetDate);
  if(!result){if(reference&&usableFx(reference,baseDate,targetDate))return reference;throw new Error('主备汇率均缺失');}
  const value={...result,source:'Frankfurter / ECB参考汇率（与基金估值汇率可能不同）',referenceOnly:true};
  if(!usableFx(value,baseDate,targetDate))throw new Error('备用汇率日期不可用');
  return value;
  }catch(error){if(reference&&usableFx(reference,baseDate,targetDate))return reference;throw error;}
}
export function completedBars(series,market,now=new Date()) {
  const id={'美国':'US','香港':'HK','中国内地':'CN','日本':'JP','韩国':'KR'}[market[0]];
  if(id)return series.filter(b=>marketStatus(b.date,id,now).state==='complete');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:market[2],year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  const local=`${parts.year}-${parts.month}-${parts.day}`;
  // A one-hour buffer avoids treating an in-progress daily candle as a final close.
  return series.filter(b=>b.date<local || b.date===local && Number(parts.hour)>=market[3]+1);
}
export async function rowWithPrices(row,baseDate,targetDate,now=new Date()) {
  let detail={...row};
  try {
    const secid=await resolve(row),market=markets[secid?.split('.')[0]];
    if(!secid||!market) throw new Error('未匹配到唯一的原上市市场行情');
    const id=marketId(secid),status=marketStatus(targetDate,id,now);
    detail={...row,secid,market:market[0],currency:market[1],marketStatus:status};
    if(status.state==='pending')throw new Error(status.message);
    const quote=await stockBars(secid,targetDate,baseDate,now);
    const series=completedBars(quote.rows,market,now);
    const stock=movement(series,baseDate,targetDate);
    if(!stock) throw new Error('缺少基准日或目标日价格');
    detail={...detail,stock,quoteSource:quote.source};
    if(!canUseBar(stock.target,targetDate,id,now)||!quoteDateMatches(stock.base.date,baseDate,id)) throw new Error(`缺少应有交易日行情：${stock.base.date} → ${stock.target.date}，未计入预估`);
    let fx={return:0,base:null,target:null};
    if(market[1]!=='CNY') {
      fx=await fxMovement(market[1],baseDate,targetDate);
      if(!fx) throw new Error('缺少汇率数据');
      detail.fx=fx;
      if(!usableFx(fx,baseDate,targetDate)) throw new Error('汇率缺失或超过14天，未计入预估');
    }
    const rmbReturn=(1+stock.return)*(1+fx.return)-1;
    const dailyBase=previousWeekday(new Date(targetDate+'T12:00:00Z'));
    const dailyStock=movement(series,dailyBase,targetDate);
    if(!dailyStock||!quoteDateMatches(dailyStock.base.date,dailyBase,id))throw new Error('缺少单日基准交易日行情，未计入预估');
    const dailyFx=market[1]==='CNY'?{return:0}:await fxMovement(market[1],dailyBase,targetDate);
    if(market[1]!=='CNY'&&!usableFx(dailyFx,dailyBase,targetDate))throw new Error('单日汇率不可用');
    const dailyRmbReturn=(1+dailyStock.return)*(1+dailyFx.return)-1;
    const notes=[];
    if(stock.target.date!==targetDate) notes.push(status.message+'；股价沿用 '+stock.target.date+' 收盘，汇率独立计算');
    if(!status.known)notes.push('节假日日历未覆盖，仅使用日期匹配的已收盘行情');
    if(fx.target && fx.target.date!==targetDate) notes.push('汇率沿用最近中间价');
    return {...detail,stock,fx,dailyStock,dailyFx,dailyBaseDate:dailyBase,dailyRmbReturn,quoteSource:quote.source,rmbReturn,contribution:row.weight/100*rmbReturn,notes};
  } catch(e) {return {...detail,rmbReturn:null,contribution:null,error:e.message};}
}
export async function mapLimit(items,fn,limit=4) {
  const result=new Array(items.length);let index=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(index<items.length){const i=index++;result[i]=await fn(items[i],i);}}));return result;
}
export function usableFx(fx,baseDate,targetDate){
  return Number.isFinite(fx?.return)&&[[fx.base,baseDate],[fx.target,targetDate]].every(([bar,date])=>bar?.date<=date&&Date.parse(date)-Date.parse(bar.date)<=14*86400000);
}
