export function chinaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function previousWeekday(now = new Date()) {
  const d = new Date(chinaDate(now)+'T12:00:00Z');
  do { d.setUTCDate(d.getUTCDate()-1); } while ([0,6].includes(d.getUTCDay()));
  return d.toISOString().slice(0,10);
}
export function validDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;
}
export function closeAt(bars,date) { return bars.filter(b=>b.date<=date && b.close>0).sort((a,b)=>b.date.localeCompare(a.date))[0] ?? null; }
export function movement(bars,baseDate,targetDate,inverse=false) {
  const base=closeAt(bars,baseDate), target=closeAt(bars,targetDate);
  if(!base || !target) return null;
  return {base,target,return:inverse ? base.close/target.close-1 : target.close/base.close-1};
}
// The weights are disclosed NAV weights, not weights renormalized to 100%.
export function estimate(base,rows) {
  const usable=rows.filter(r=>Number.isFinite(r.rmbReturn));
  const coverage=usable.reduce((s,r)=>s+r.weight,0);
  const contribution=usable.reduce((s,r)=>s+r.weight/100*r.rmbReturn,0);
  const disclosed=rows.reduce((s,r)=>s+r.weight,0);
  return {value:coverage>0 && disclosed<=100.5 ? base.value*(1+contribution) : null,
    return:contribution,coverage,disclosed,unknown:Math.max(0,100-coverage),method:'weighted-zero-tail-v1'};
}
export function reconcile(previous, candidate, actual, now) {
  const originalForecast=previous?.originalForecast??previous?.forecast??(!actual?candidate?.model?.value!=null?candidate:null:null);
  if(actual) return {forecast:previous?.forecast ?? null,firstForecastAt:previous?.firstForecastAt ?? null,actual,
    originalForecast,firstActualSeenAt:previous?.firstActualSeenAt ?? now,updatedAt:now};
  if(previous?.actual) return previous; // a transient source regression must not erase an actual value
  return {forecast:candidate?.model?.value!=null ? candidate : previous?.forecast ?? null,
    originalForecast,firstForecastAt:previous?.firstForecastAt ?? (candidate?.model?.value!=null?now:null),actual:null,updatedAt:now};
}
export function estimateMarket(base,rows){
  const model=estimate(base,rows),usable=rows.filter(r=>Number.isFinite(r.rmbReturn)&&Number.isFinite(r.dailyRmbReturn));
  return {...model,method:'market-close-v3',dailyReturn:usable.reduce((n,r)=>n+r.weight/100*r.dailyRmbReturn,0)};
}
