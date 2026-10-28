import {validDate} from './model.mjs';

const cache=new Map(),pending=new Map();
const indexUrl=code=>`https://fundf10.eastmoney.com/jjgg_${code}_3.html`;
// Report year describes the holdings period, not the announcement publication year.
export function reportPeriod(title){
 const text=String(title??'').replace(/\s/g,'');
 if(/提示|摘要/.test(text))return null;
 const year=text.match(/(20\d{2})年/);if(!year)return null;
 const quarter=text.match(/第?([1-4一二三四])季(?:度)?报告/);
 if(quarter){const q=Number(quarter[1])||{'一':1,'二':2,'三':3,'四':4}[quarter[1]];return year[1]+'-'+['03-31','06-30','09-30','12-31'][q-1];}
 if(/中期报告|半年度报告/.test(text))return year[1]+'-06-30';
 if(/年度报告/.test(text))return year[1]+'-12-31';
 return null;
}
export function matchAnnouncements(code,dates,entries){
 return {indexUrl:indexUrl(code),periods:[...new Set(dates)].map(asOf=>({asOf,reports:entries.filter(r=>r.FUNDCODE===code&&/^AN\d+$/.test(r.ID)&&reportPeriod(r.TITLE)===asOf)
  .map(r=>({title:r.TITLE,publishedAt:String(r.PUBLISHDATE??'').slice(0,10),url:`https://fund.eastmoney.com/gonggao/${code},${r.ID}.html`}))}))};
}
export async function holdingsAnnouncements(code,dates,{fetcher=fetch}={}){
 if(!/^\d{6}$/.test(code)||!dates.length||dates.length>2||dates.some(d=>!validDate(d)))throw Error('基金代码或披露日期无效');
 const saved=cache.get(code);let entries=saved&&Date.now()-saved.at<3600000?saved.entries:null;
 if(!entries){
  let task=pending.get(code);
  if(!task){
   task=(async()=>{
    const response=await fetcher(`https://api.fund.eastmoney.com/f10/JJGG?fundcode=${code}&pageIndex=1&pageSize=200&type=3`,{headers:{Referer:'https://fundf10.eastmoney.com/','User-Agent':'Mozilla/5.0 QdiiHelp/1.0'},signal:AbortSignal.timeout(14000)});
    if(!response.ok)throw Error('公告数据源返回 HTTP '+response.status);
    const data=JSON.parse(await response.text());
    if(data.ErrCode!==0||!Array.isArray(data.Data))throw Error('公告数据格式异常');
    cache.set(code,{at:Date.now(),entries:data.Data});return data.Data;
   })();pending.set(code,task);
  }
  try{entries=await task;}finally{if(pending.get(code)===task)pending.delete(code);}
 }
 return matchAnnouncements(code,dates,entries);
}
