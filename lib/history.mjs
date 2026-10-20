import fs from 'node:fs';
import path from 'node:path';
export function buildComparison(series,days=90,now=new Date()) {
  if(series.length<1)throw new Error('请选择基金');
  const cutoff=new Date(now);cutoff.setUTCDate(cutoff.getUTCDate()-(days===0?100000:days));const start=cutoff.toISOString().slice(0,10);
  const sorted=series.map(s=>{
    const rows=s.rows.filter(r=>r.date<=now.toISOString().slice(0,10)).sort((a,b)=>a.date.localeCompare(b.date)).map(r=>({...r}));
    for(let i=1;i<rows.length;i++){
      const r=rows[i],prev=rows[i-1];
      if(!Number.isFinite(r.dailyReturn)&&prev.value>0&&r.value>0&&Number.isFinite(r.cumulativeNav)&&Number.isFinite(prev.cumulativeNav)&&!r.adjustment){
        const cash=(r.cumulativeNav-r.value)-(prev.cumulativeNav-prev.value);
        if(cash>=-0.00001){r.dailyReturn=(r.value+Math.max(0,cash))/prev.value-1;r.derived=true;}
      }
    }
    return {...s,rows};
  });
  const dateSets=sorted.map(s=>new Set(s.rows.map(r=>r.date)));
  const common=sorted[0].rows.map(r=>r.date).filter(d=>d>=start&&dateSets.every(dates=>dates.has(d)));
  if(common.length<2)throw new Error('共同净值日期不足，无法对比');
  const base=common[0],end=common.at(-1),commonSet=new Set(common);
  return {base,end,dates:common,series:sorted.map(s=>{
    let growth=1,peak=1,drawdown=0;const points=[];
    for(const r of s.rows.filter(r=>r.date>=base&&r.date<=end)){
      if(r.date!==base){if(!Number.isFinite(r.dailyReturn)||r.dailyReturn<=-1)throw new Error(`${s.code} ${r.date} 缺少有效公布涨跌幅，无法复合计算`);growth*=1+r.dailyReturn;}
      peak=Math.max(peak,growth);drawdown=Math.min(drawdown,growth/peak-1);
      if(commonSet.has(r.date))points.push({date:r.date,cumulative:growth-1,daily:r.dailyReturn,value:r.value});
    }
    return {...s,rows:undefined,points,totalReturn:growth-1,maxDrawdown:drawdown,derivedDates:s.rows.filter(r=>r.derived&&r.date>base&&r.date<=end).map(r=>r.date)};
  })};
}
const inFlight=new Map();
let historyStorage=null;
export function configureHistoryStorage(storage){historyStorage=storage;}
export function savedHistory(code,root){
 if(historyStorage)return historyStorage.read(code)??null;
 try{const h=JSON.parse(fs.readFileSync(path.join(root,'data','history',code+'.json'),'utf8'));return h.schema===2?h:null;}catch{return null;}
}
export async function fetchHistory(code,root,options={}) {
  if(!options.force&&historyStorage?.range&&(options.from||options.to)){
   const cached=await historyStorage.range(code,{from:options.from,to:options.to});
   if(cached?.schema===2&&cached.historyComplete===true&&Date.now()-Date.parse(cached.fetchedAt)<3600000)return cached;
  }
  const key=root+':'+code;if(inFlight.has(key))return inFlight.get(key);
  const task=downloadHistory(code,root,options);inFlight.set(key,task);
  try{return await task;}finally{inFlight.delete(key);}
}
async function downloadHistory(code,root,{force=false,fetcher=fetch}={}) {
  const dir=path.join(root,'data','history');if(!historyStorage)fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,code+'.json');
  const old=historyStorage?(historyStorage.load?await historyStorage.load(code):savedHistory(code,root)):(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null);
  if(!force&&old?.schema===2&&old.historyComplete===true&&Date.now()-Date.parse(old.fetchedAt)<3600000)return old;
  try{
    const rows=[],seen=new Set();let complete=false,totalCount=null;
    const fullFetchedAt=old?.fullFetchedAt??old?.fetchedAt;
    // Refresh a recent overlapping page; periodically recheck older corrections.
    const incremental=!force&&old?.historyComplete===true&&old?.schema===2&&Array.isArray(old.rows)&&old.rows.length>0
      &&Date.now()-Date.parse(fullFetchedAt)<7*86400000;
    const oldDates=new Set(incremental?old.rows.map(r=>r.date):[]);
    for(let page=1;page<=2000;page++){
      const url=`https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=${page}&pageSize=20`;
      const res=await fetcher(url,{headers:{Referer:'https://fundf10.eastmoney.com/'},signal:AbortSignal.timeout(14000)});
      if(!res.ok)throw new Error('历史接口 HTTP '+res.status);
      const j=await res.json(),list=j.Data?.LSJZList;
      if(!Array.isArray(list))throw new Error('历史净值接口格式异常');
      if(Number(j.TotalCount)>0)totalCount=Number(j.TotalCount);
      if(!list.length){if(totalCount!==null&&rows.length<totalCount)throw Error('历史接口提前返回空页');complete=true;break;}
      let added=0;for(const r of list){if(!seen.has(r.FSRQ)){seen.add(r.FSRQ);added++;rows.push({date:r.FSRQ,value:Number(r.DWJZ),cumulativeNav:r.LJJZ?Number(r.LJJZ):null,adjustment:/折算|拆分|合并/.test(r.FHSP||''),dailyReturn:r.JZZZL===null||r.JZZZL===undefined||r.JZZZL===''?null:Number(r.JZZZL)/100});}}
      if(!added)throw new Error('历史接口重复分页，已停止以免生成不完整曲线');
      if(incremental&&list.some(r=>oldDates.has(r.FSRQ))){
        for(const row of old.rows)if(!seen.has(row.date)){seen.add(row.date);rows.push(row);}
        complete=true;break;
      }
      if((Number(j.TotalCount)>0?rows.length>=Number(j.TotalCount):list.length<20)){complete=true;break;}
    }
    if(!complete||!rows.length)throw new Error('历史分页下载未完成');
    rows.sort((a,b)=>b.date.localeCompare(a.date));
    const fetchedAt=new Date().toISOString();
    const data={schema:2,code,rows,historyComplete:true,totalCount:rows.length,fetchedAt,fullFetchedAt:incremental?fullFetchedAt:fetchedAt,source:'天天基金公布的单位净值、累计净值及日涨跌幅',stale:false};
    if(historyStorage)await historyStorage.write(code,data);
    else{fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2));fs.renameSync(file+'.tmp',file);}return data;
  }catch(e){if(old)return {...old,stale:true,error:e.message};throw e;}
}
