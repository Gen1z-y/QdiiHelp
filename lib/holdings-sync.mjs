import {holdings,bondHoldings,fundProfile,mapLimit} from './provider.mjs';
import {holdingsChanged,selectHoldingSnapshot} from './holdings-version.mjs';
import {MAX_HOLDINGS_AGE_DAYS} from './estimation-rules.mjs';
import {indexForFund} from './indices.mjs';

const indexProfile=profile=>!!profile&&(!!profile.index||!!indexForFund(profile.name??'')||/联接|指数/.test(profile.name??''));
export function isIndexFund(data,code){
 return indexProfile(data.profiles?.[code]?.profile)||Object.values(data.lastView??{}).some(v=>v.code===code&&indexProfile(v));
}

export function isBondFund(data,code){
 const profile=data.profiles?.[code]?.profile;
 if(typeof profile?.bond==='boolean')return profile.bond;
 return Object.values(data.lastView??{}).some(v=>v.code===code&&v.bond);
}
// Save both sides in the report before replacing a snapshot. Quotes and other
// forecast fields are deliberately excluded from this disclosure comparison.
export function disclosureSnapshot(holding){
 return holding?.rows?.length?{asOf:holding.asOf,rows:holding.rows.map(({name,code,secid,currency,weight})=>({name,code,secid,currency,weight}))}:null;
}
export function syncComparison(previous,latest){
 return {previousHoldings:disclosureSnapshot(previous),holdings:disclosureSnapshot(latest),syncedAt:new Date().toISOString()};
}
export function stockHoldingsReport(report,data){
 if(!report)return null;
 const items=report.items.filter(r=>!isIndexFund(data,r.code)&&!indexProfile(r)).map(r=>{
  const bond=isBondFund(data,r.code)||!!r.bond;
  const candidates=bond?[data.bondHoldingsSnapshots?.[r.code]]:[data.holdingsSnapshots?.[r.code],...Object.values(data.lastView??{}).filter(v=>v.code===r.code).map(v=>v.latestHoldings)];
  const holding=[r.holdings,...candidates].find(h=>h?.asOf===r.date&&h?.rows?.length);
  return {...r,bond,holdings:disclosureSnapshot(holding)};
 });
 return {...report,items,summary:Object.fromEntries(['updated','unchanged','failed','unsupported'].map(s=>[s,items.filter(r=>r.status===s).length])),
  ...(report.recalculation?{recalculation:Object.fromEntries(['updated','published','unavailable'].map(s=>[s,items.filter(r=>r.recalculation===s).length]))}:{})};
}

// Keep disclosed snapshots separate from forecasts saved before publication.
export async function syncHoldings(store,onProgress=()=>{},{fetchHoldings=holdings,fetchProfile=fundProfile,fetchBondHoldings=bondHoldings}={}) {
 const candidates=store.data.watchlist.filter(code=>!isIndexFund(store.data,code));let completed=0;
 store.data.holdingsSnapshots??={};store.data.bondHoldingsSnapshots??={};
 onProgress({completed:0,total:null,stage:'确认需要披露持仓的基金范围'});
 const prepared=await mapLimit(candidates,async code=>{
  // A stored profile already classifies bonds and index funds; only unknown
  // funds need a network profile fetch here.
  const storedProfile=store.data.profiles?.[code]?.profile;
  if(storedProfile&&(storedProfile.bond===true||indexProfile(storedProfile)))return {code,profile:storedProfile};
  try{const profile=await fetchProfile(code,{force:true});store.data.profiles??={};store.data.profiles[code]={profile,fetchedAt:new Date().toISOString()};return {code,profile};}
  catch(error){return {code,error};}
 },2);
 const eligible=prepared.filter(p=>!indexProfile(p.profile)),codes=eligible.map(p=>p.code);
 onProgress({completed,total:codes.length});
 const items=await mapLimit(eligible,async ({code,profile,error})=>{
  const views=Object.values(store.data.lastView).filter(v=>v.code===code&&v.latestHoldings?.asOf).sort((a,b)=>b.latestHoldings.asOf.localeCompare(a.latestHoldings.asOf));
  const stored=store.data.holdingsSnapshots[code],view=views[0]?.latestHoldings;
  const previous=profile?.bond?store.data.bondHoldingsSnapshots[code]:(stored&&(!view||stored.asOf>=view.asOf)?stored:view);
  let name=views[0]?.name??code,result;
  try {
   if(error)throw error;name=profile.name;
   if(profile.bond){
    if(fetchBondHoldings===bondHoldings)await new Promise(resolve=>setTimeout(resolve,750));
    const latest=await fetchBondHoldings(code,{force:true});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(latest.asOf)||!latest.rows?.length)throw new Error('未获取到有效披露债券持仓');
    const previousBond=store.data.bondHoldingsSnapshots[code];
    selectHoldingSnapshot(previousBond,latest);
    const changed=holdingsChanged(previousBond,latest);
    store.data.bondHoldingsSnapshots[code]={...latest,fetchedAt:new Date().toISOString()};
    result={code,name,bond:true,status:changed?'updated':'unchanged',previousDate:previousBond?.asOf??null,date:latest.asOf,count:latest.rows.length,bonds:latest.rows.map(({name:bn,code:bc,weight})=>({name:bn,code:bc,weight})),message:changed?'已更新披露债券持仓':'已是数据源最新披露债券持仓'};
   }
   else if(profile.allocation?.stock===0)result={code,name,status:'unsupported',previousDate:previous?.asOf??null,date:null,count:0,message:profile.allocation.date+' 资产配置股票占比为0，股票持仓同步不适用，需要基金投资或其他资产明细'};
   else {
    // Pace a full-watchlist refresh to avoid hammering the disclosure endpoint.
    if(fetchHoldings===holdings)await new Promise(resolve=>setTimeout(resolve,750));
    let latest;
    try{latest=await fetchHoldings(code,{force:true});}
    catch(e){if(fetchHoldings!==holdings||!/HTTP (429|514|503)/.test(e.message))throw e;
      await new Promise(resolve=>setTimeout(resolve,2000));latest=await fetchHoldings(code,{force:true});}
    if(!/^\d{4}-\d{2}-\d{2}$/.test(latest.asOf)||!latest.rows?.length)throw new Error('未获取到有效披露持仓');
    const selected=selectHoldingSnapshot(previous,latest);latest=selected.holding;
    const changed=holdingsChanged(previous,latest);
    store.data.holdingsSnapshots[code]={...latest,fetchedAt:new Date().toISOString(),source:'东方财富 · 基金披露股票持仓'};
    const stale=Date.now()-Date.parse(latest.asOf)>MAX_HOLDINGS_AGE_DAYS*86400000;
    result={code,name,status:changed?'updated':'unchanged',previousDate:previous?.asOf??null,date:latest.asOf,count:latest.rows.length,message:(changed?'已更新':'已是数据源最新披露')+(selected.warning?'；'+selected.warning:latest.expansionError?'；只取得重仓股，完整明细获取失败：'+latest.expansionError:'')+(stale?`；披露日期超过${MAX_HOLDINGS_AGE_DAYS}天，数据源尚未提供更新持仓`:'')};
   }
  }catch(e){result={code,name,status:'failed',previousDate:previous?.asOf??null,date:previous?.asOf??null,count:previous?.rows?.length??0,message:e.message};}
  const latest=profile?.bond?store.data.bondHoldingsSnapshots[code]:store.data.holdingsSnapshots[code];
  Object.assign(result,syncComparison(previous,latest?.asOf===result.date?latest:previous));
  onProgress({completed:++completed,total:codes.length,code,name});return result;
 },1);
 const summary=Object.fromEntries(['updated','unchanged','failed','unsupported'].map(status=>[status,items.filter(i=>i.status===status).length]));
 for(const it of items)it.group=store.data.fundGroups?.[it.code]??'watch';
 const report={items,summary,serverTime:new Date().toISOString()};
 store.data.lastHoldingsSync=report;store.save();return report;
}
