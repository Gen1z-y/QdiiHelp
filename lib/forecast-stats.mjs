import {validDate} from './model.mjs';

function summarize(samples,limit){
 const rows=samples.slice(0,limit),count=rows.length;
 return {limit,count,mae:count?rows.reduce((n,r)=>n+Math.abs(r.error),0)/count:null,
  bias:count?rows.reduce((n,r)=>n+r.error,0)/count:null,
  direction:count?rows.filter(r=>Math.sign(r.forecast)===Math.sign(r.actual)).length/count:null,
  from:rows.at(-1)?.date??null,to:rows[0]?.date??null};
}

// Compare cumulative model return with the published NAV interval return, not
// with a single overseas session. Missing timestamps/bases are not evidence.
export function forecastStats(code,records,{historyRows=[],targetDate=null,historyDays=90,validation=true}={}){
 const entries=Object.entries(records).filter(([key])=>key.startsWith(code+':')).sort(([a],[b])=>b.localeCompare(a));
 const recordedPairs=entries.filter(([,r])=>r.actual||r.forecast||r.indexClose||r.rejectedForecasts?.length).map(([key,r])=>({
  date:key.slice(7),forecast:Number.isFinite(r.forecast?.model?.return)?r.forecast.model.return:null,
  actual:r.actual?.dailyReturn??r.actual?.intervalReturn??null,baseDate:r.forecast?.base?.date,actualFrom:r.actual?.returnFrom??r.actual?.previousDate,actualTo:r.actual?.returnTo??r.actual?.date,actualSource:r.actual?.returnSource,intervalOnly:!Number.isFinite(r.actual?.dailyReturn)&&Number.isFinite(r.actual?.intervalReturn),indexClose:r.indexClose,rejection:r.rejectedForecasts?.at(-1)?.reason
 }));
 const byDate=new Map(recordedPairs.map(r=>[r.date,r]));
 const latest=targetDate??[...historyRows.map(r=>r.date),...recordedPairs.map(r=>r.date)].filter(validDate).sort().at(-1);
 const cutoff=latest?new Date(Date.parse(latest)-historyDays*86400000).toISOString().slice(0,10):null;
 const orderedHistory=[...historyRows].sort((a,b)=>b.date.localeCompare(a.date));
 for(const [i,r] of orderedHistory.entries()){
  const actual=r.dailyReturn??r.intervalReturn;
  if(!validDate(r.date)||!Number.isFinite(actual)||!(r.value>0)||r.date>latest||r.date<cutoff)continue;
  const old=byDate.get(r.date)??{date:r.date,forecast:null};
  byDate.set(r.date,{...old,actual,actualFrom:r.returnFrom??r.previousDate??orderedHistory[i+1]?.date??old.actualFrom,
   actualTo:r.returnTo??r.date,intervalOnly:!Number.isFinite(r.dailyReturn),actualSource:'官方历史净值'});
 }
 const pairs=[...byDate.values()].filter(r=>!targetDate||r.date<=targetDate).sort((a,b)=>b.date.localeCompare(a.date));
 const samples=[],excluded={unpaired:0,interval:0,timestamp:0,invalid:0};
 for(const [key,r] of entries){
  const f=r.forecast,a=r.actual,date=key.slice(7);
  if(!f||!a){excluded.unpaired++;continue;}
  if(f.base?.provisional||f.referenceOnly){excluded.interval++;continue;}
  if(!validDate(date)||f.date!==date||a.date!==date||!Number.isFinite(f.model?.return)||!Number.isFinite(a.dailyReturn)||!f.model?.method){excluded.invalid++;continue;}
  if(!validDate(a.previousDate)||f.base?.date!==a.previousDate){excluded.interval++;continue;}
  const calculated=Date.parse(f.calculatedAt),first=Date.parse(r.firstForecastAt),published=Date.parse(r.firstActualSeenAt);
  if(!Number.isFinite(calculated)||!Number.isFinite(first)||!Number.isFinite(published)||first>=published||calculated>=published){excluded.timestamp++;continue;}
  if(targetDate&&date>targetDate)continue;
  samples.push({date,method:f.model.method,forecast:f.model.return,actual:a.dailyReturn,error:(f.model.return-a.dailyReturn)*100,calculatedAt:calculated,actualSeenAt:published});
 }
 const methods=[...new Set(entries.map(([,r])=>r.forecast?.model?.method).filter(Boolean))];
 const groups=methods.map(method=>{const own=samples.filter(r=>r.method===method);return {method,count:own.length,windows:[summarize(own,30),summarize(own,90)],...(validation?{validation:validateCalibration(own)}:{})};});
 return {pairs,pairedCount:samples.length,groups,excluded,mae:groups[0]?.windows[0].mae??null};
}

export function validateCalibration(samples){
 const chronological=[...samples].sort((a,b)=>a.date.localeCompare(b.date)),evaluations=[];
 for(let i=chronological.length-1;i>=0&&evaluations.length<90;i--){
  const s=chronological[i];
  // Only actual results already observed at the time of this forecast can train it.
  const prior=chronological.slice(0,i).filter(p=>p.date<s.date&&p.actualSeenAt<s.calculatedAt).slice(-30);
  if(prior.length<10)continue;
  const bias=prior.reduce((n,p)=>n+p.error,0)/prior.length;
  evaluations.push({date:s.date,rawError:s.error,correctedError:s.error-bias,trainingCount:prior.length});
 }
 const rows=evaluations.reverse(),count=rows.length;
 const rawMae=count?rows.reduce((n,s)=>n+Math.abs(s.rawError),0)/count:null;
 const correctedMae=count?rows.reduce((n,s)=>n+Math.abs(s.correctedError),0)/count:null;
 const trend=[...samples].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20);
 const avg=a=>a.length?a.reduce((n,s)=>n+Math.abs(s.error),0)/a.length:null;
 return {count,rawMae,correctedMae,improvement:count?rawMae-correctedMae:null,from:rows[0]?.date??null,to:rows.at(-1)?.date??null,
  recentMae:avg(trend.slice(0,10)),previousMae:avg(trend.slice(10)),recentCount:Math.min(10,trend.length),previousCount:Math.max(0,trend.length-10),
  points:trend.reverse().map(s=>({date:s.date,error:s.error})),evaluations:rows};
}
