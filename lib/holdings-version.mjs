// Source ordering and fetch timestamps do not change the economic inputs.
export function holdingsVersion(holding){
 if(!holding)return null;
 const rows=(holding.rows??[]).map(r=>[r.secid??'',r.code??'',r.currency??'',Number(r.weight)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return JSON.stringify([holding.asOf,rows]);
}
export function holdingsChanged(before,after){return holdingsVersion(before)!==holdingsVersion(after);}
// Compare against the inputs that produced the displayed forecast, so a
// successful disclosure fetch can retry an earlier failed recalculation.
export function forecastHoldingsChanged(forecast,holding){
 if(!forecast||!holding||!forecast.model?.method?.startsWith('market-close-'))return false;
 const rows=(holding.rows??[]).filter(r=>r.weight>0);
 // Price collection enriches rows with resolved markets and currencies. These
 // are not a disclosure change when the source did not supply those fields.
 const before=(forecast.rows??[]).map(r=>{
  const source=rows.find(s=>s.code===r.code&&s.secid===r.secid)??rows.find(s=>s.code===r.code);
  return {...r,secid:source?.secid?r.secid:undefined,currency:source?.currency?r.currency:undefined};
 });
 return holdingsChanged({asOf:forecast.holdingsDate,rows:before},{asOf:holding.asOf,rows});
}

export function selectHoldingSnapshot(previous,latest){
 if(previous?.asOf>latest.asOf)throw Error('数据源返回更旧的持仓，已保留 '+previous.asOf);
 if(previous?.asOf===latest.asOf&&previous.rows?.length>latest.rows?.length&&(latest.expanded===false||latest.expansionError)){
  return {holding:previous,warning:'完整明细获取失败，已保留原有 '+previous.rows.length+' 项持仓'+(latest.expansionError?'：'+latest.expansionError:'')};
 }
 return {holding:latest,warning:null};
}
