import {indexClose} from './indices.mjs';
import {fxMovement,usableFx,mapLimit} from './provider.mjs';
import {quoteDateMatches,session} from './calendar.mjs';
import {previousWeekday,validDate,chinaDate} from './model.mjs';

export async function exportIndices(windows,{currency='CNY',quote=indexClose,fx=fxMovement}={}){
 if(!['CNY','USD'].includes(currency)||!Array.isArray(windows)||!windows.length||windows.length>16)throw new Error('指数导出参数无效');
 for(const {date,from} of windows){
  if(!validDate(date)||date>chinaDate()||Date.now()-Date.parse(date)>100*86400000
   ||from!=null&&(!validDate(from)||from>=date||Date.parse(date)-Date.parse(from)>410*86400000))throw new Error('指数导出日期无效');
 }
 const rates=new Map();
 const movement=(from,to)=>{const key=from+':'+to;if(!rates.has(key))rates.set(key,fx('USD',from,to));return rates.get(key);};
 const specs=[['IXIC','纳斯达克综合'],['NDX','纳斯达克100'],['SPX','标普500']];
 const items=await mapLimit(windows,async({date,from=null})=>{
  const base=from??previousWeekday(new Date(date+'T12:00:00Z'));
  let fxInfo=null;
  if(currency==='CNY')try{
   const rate=await movement(base,date);
   if(usableFx(rate,base,date))fxInfo={value:rate.return,baseDate:rate.base?.date??null,targetDate:rate.target?.date??null,carried:(rate.target?.date??null)!==date,source:rate.source??null};
   else fxInfo={error:'对应区间汇率暂不可用'};
  }catch(e){fxInfo={error:e.message};}
  const indices=await Promise.all(specs.map(async([id,name])=>{
   try{
    const q=await quote(id,date,base);
    if(q.stale||!quoteDateMatches(q.date,date,'US')||!quoteDateMatches(q.baseDate,base,'US')||!(q.close>0&&q.baseClose>0))throw new Error('缺少对应区间的指数收盘行情');
    const usdValue=q.close/q.baseClose-1;
    let value=usdValue;
    if(currency==='CNY'){
     const rate=await movement(base,date);if(!usableFx(rate,base,date))throw new Error('对应区间汇率暂不可用');
     value=(1+usdValue)*(1+rate.return)-1;
    }
    return {id,name,value,usdValue:currency==='CNY'?usdValue:null,closed:!from&&session(date,'US').closed,quoteDate:q.date,baseQuoteDate:q.baseDate,source:q.source};
   }catch(e){return {id,name,value:null,usdValue:null,error:e.message};}
  }));
  return {date,from,fx:fxInfo,indices};
 },2);
 return {currency,items};
}
