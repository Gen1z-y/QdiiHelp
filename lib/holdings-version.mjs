// Source ordering and fetch timestamps do not change the economic inputs.
export function holdingsVersion(holding){
 if(!holding)return null;
 const rows=(holding.rows??[]).map(r=>[r.secid??'',r.code??'',r.currency??'',Number(r.weight)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return JSON.stringify([holding.asOf,rows]);
}
export function holdingsChanged(before,after){return holdingsVersion(before)!==holdingsVersion(after);}

export function selectHoldingSnapshot(previous,latest){
 if(previous?.asOf>latest.asOf)throw Error('数据源返回更旧的持仓，已保留 '+previous.asOf);
 if(previous?.asOf===latest.asOf&&previous.rows?.length>latest.rows?.length&&(latest.expanded===false||latest.expansionError)){
  return {holding:previous,warning:'完整明细获取失败，已保留原有 '+previous.rows.length+' 项持仓'+(latest.expansionError?'：'+latest.expansionError:'')};
 }
 return {holding:latest,warning:null};
}
