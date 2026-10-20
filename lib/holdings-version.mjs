// Source ordering and fetch timestamps do not change the economic inputs.
export function holdingsVersion(holding){
 if(!holding)return null;
 const rows=(holding.rows??[]).map(r=>[r.secid??'',r.code??'',r.currency??'',Number(r.weight)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return JSON.stringify([holding.asOf,rows]);
}
export function holdingsChanged(before,after){return holdingsVersion(before)!==holdingsVersion(after);}
