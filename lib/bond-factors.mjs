import {readQuoteCache,writeQuoteCache} from './quote-cache.mjs';

// IDs verified against ChinaBond's public queryTree. CFZS is the wealth
// series, already including accrued interest / reinvestment: no extra coupon.
export const ADAPTIVE_BOND_FACTORS=[
 {symbol:'cb:short',name:'中债1-3年国债财富',id:'cc1cfe89b0cbd0800420a0e037026407'},
 {symbol:'cb:long',name:'中债7-10年国债财富',id:'8a8b2c8f5a492a01015a4ac986480043'},
 {symbol:'cb:ultra',name:'中债30年国债财富',id:'8a8b2cef77b239980177b485d20a6379'},
 {symbol:'cb:policy',name:'中债国开行债券财富',id:'2c908188111fac07011125068f91044d'},
 {symbol:'cb:credit',name:'中债中高等级信用债财富',id:'6cdea6720316fd5d69494b4bc0f8129c'},
 {symbol:'cb:bank',name:'中债金融行业信用债财富',id:'594b0c6f18d6dd3c6af0830d784058fa'},
 {symbol:'cb:mtn',name:'中债新中期票据财富',id:'8a8b2ca0375f977f0138c2c322474b06'},
 {symbol:'cb:cd',name:'中债同业存单财富',id:'8a8b2c8f611af5db01611cb3586c00f0'},
];
const cache=new Map(),pending=new Map();
export function parseBondWealth(data){
 const raw=data?.CFZS_00;if(!raw||Array.isArray(raw)||typeof raw!=='object')throw Error('中债财富指数格式异常');
 const dates=new Set();
 const bars=Object.entries(raw).map(([time,value])=>{
  const stamp=Number(time),close=typeof value==='number'?value:NaN;
  if(!Number.isFinite(stamp)||stamp<0||!Number.isFinite(close)||close<=0)throw Error('中债财富指数包含无效数据');
  const date=new Date(stamp+8*3600000).toISOString().slice(0,10);
  if(dates.has(date))throw Error('中债财富指数日期重复');dates.add(date);
  return {date,close};
 }).sort((a,b)=>a.date.localeCompare(b.date));
 if(bars.length<2)throw Error('中债财富指数历史不足');
 return bars.map((bar,i)=>({...bar,dayReturn:i?bar.close/bars[i-1].close-1:null,previousDate:bars[i-1]?.date}));
}
export async function bondWealthBars(symbol,target,{fetcher=fetch}={}){
 const factor=ADAPTIVE_BOND_FACTORS.find(f=>f.symbol===symbol);if(!factor)throw Error('未知中债因子');
 const key='bondwealth-v1:'+symbol,ttl=4*3600000;
 const saved=cache.get(symbol)??readQuoteCache(key,ttl);
 const age=saved?Date.now()-saved.time:Infinity;
 const fresh=saved&&age<ttl&&(saved.data?.some(b=>b.date===target)||age<240000);
 if(fresh)return saved.data.filter(b=>b.date<=target);
 if(!pending.has(symbol))pending.set(symbol,(async()=>{
  const u=new URL('https://yield.chinabond.com.cn/cbweb-mn/indices/singleIndexQueryResult');
  for(const [k,v] of Object.entries({indexid:factor.id,qxlxt:'00',ltcslx:'',zslxt:'CFZS',zslxt1:'CFZS',lx:'1',locale:'zh_CN'}))u.searchParams.set(k,v);
  const r=await fetcher(u,{method:'POST',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('中债财富指数 HTTP '+r.status);
  const bars=parseBondWealth(await r.json());
  const data=bars.slice(-600);cache.set(symbol,{time:Date.now(),data});writeQuoteCache(key,data);return data;
 })());
 const task=pending.get(symbol);
 try{return (await task).filter(b=>b.date<=target);}finally{if(pending.get(symbol)===task)pending.delete(symbol);}
}
