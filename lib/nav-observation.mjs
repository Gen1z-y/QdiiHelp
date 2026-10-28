import {expectedCloseDate,shiftDate,session,marketStatus} from './calendar.mjs';
import {chinaDate,validDate,previousWeekday,reconcile} from './model.mjs';
import {fundCalendarDay,previousFundDate} from './fund-nav-calendar.mjs';
import {exposureMarkets,periodDays,captureStage,PERIOD_VERSION} from './nav-period.mjs';
export function previousNavDate(date){return expectedCloseDate(shiftDate(date,-1),'CN');}
export function observationPlan(now=new Date(),{markets=['US','HK','JP','CN'],currentDay=false}={}){
 // A string is a Beijing daytime snapshot, useful for date-only callers.
 if(typeof now==='string')now=new Date(now+'T12:00:00+08:00');
 const today=chinaDate(now);
 let asOf=currentDay&&markets.length&&markets.every(m=>['complete','closed'].includes(marketStatus(today,m,now).state))&&!session(today,'CN').closed?today:previousWeekday(now);
 for(let i=0;i<20;i++){
  if(markets.every(m=>marketStatus(asOf,m,now).state!=='pending'))break;
  asOf=previousWeekday(new Date(asOf+'T12:00:00+08:00'));
 }
 let target=asOf;
 for(let i=0;i<30&&session(target,'CN').closed;i++)target=shiftDate(target,1);
 const from=previousNavDate(target),partial=asOf<target;
 let cumulative=false;
 for(let d=shiftDate(from,1);d<target;d=shiftDate(d,1)){
  if(session(d,'CN').reason==='交易所节假日休市')cumulative=true;
 }
 return {target,asOf,from,partial,mode:cumulative?'cumulative':'daily'};
}
export function navObservation(now=new Date()){return observationPlan(now).target;}
export function planForFund({code,holding,indexId=null,nav=[],rule=null},now=new Date()){
 nav=[...new Map(nav.filter(r=>validDate(r.date)).map(r=>[r.date,r])).values()].sort((a,b)=>b.date.localeCompare(a.date));
 const exposure=exposureMarkets(holding,indexId);
 const plan=observationPlan(now,{markets:exposure.timingComplete?exposure.markets:[...new Set(['US','HK','JP','KR','CN',...exposure.markets])],currentDay:exposure.timingComplete});
 let target=plan.target;
 // Actual publications always override a tentative non-open-day projection.
 for(let i=0;i<366;i++){
  const day=fundCalendarDay(code,target,rule);
  if(nav.some(r=>r.date===target)||!day.closed&&(!day.nonOpen||day.specialValuation))break;
  target=shiftDate(target,1);
 }
 const prior=nav.filter(r=>r.date<target).sort((a,b)=>b.date.localeCompare(a.date))[0];
 const scheduledBase=previousFundDate(code,target,rule);
 const expectedBase=prior?.date>scheduledBase?prior.date:scheduledBase;
 const actual=nav.find(r=>r.date===target);
 const from=actual?(actual.returnFrom??prior?.date??expectedBase):expectedBase;
 const notices=[];
 for(let d=shiftDate(from??plan.from,1),i=0;d<target&&i<366;i++,d=shiftDate(d,1)){
  const day=fundCalendarDay(code,d,rule);
  if(day.nonOpen||day.noValuation)notices.push({date:d,...day,
   ...(nav.some(r=>r.date===d)?{uncertain:false,noValuation:false,valuationObserved:true,reason:day.reason+'；已获取该日净值，以实际披露为准'}:{})});
 }
 return {...plan,target,from,expectedBase:from,partial:plan.asOf<target,
  mode:periodDays(from,target)>1||plan.mode==='cumulative'?'cumulative':'daily',
  targetConfirmed:session(target,'CN').known&&!notices.some(d=>d.uncertain),notices,exposure,version:PERIOD_VERSION,
  calendarKnown:session(target,'CN').known,specialValuation:fundCalendarDay(code,target,rule).specialValuation,
  today:chinaDate(now),todayStatus:fundCalendarDay(code,chinaDate(now),rule),
  publicationKey:JSON.stringify(nav.slice(0,3).map(r=>[r.date,r.value,r.dailyReturn??null,r.intervalReturn??null]))};
}
export function navEstimate(fund){
 const record=fund.record??{},forecast=record.forecast??(!record.actual?record.partialForecast:null);
 const from=forecast?.base?.date,to=fund.date,asOf=forecast?.asOf??forecast?.date;
 const expected=record.actual?.previousDate??fund.plan?.expectedBase??forecast?.valuationBaseDate??(validDate(to)?previousNavDate(to):null);
 const partial=!!forecast&&asOf<to;
 const reference=forecast?.periodVersion===PERIOD_VERSION&&forecast?.referenceOnly;
 const valid=validDate(to)&&(!session(to,'CN').closed||record.actual?.date===to||fund.plan?.specialValuation)&&forecast?.date===to&&(from===expected||reference&&from<expected)
  &&validDate(asOf)&&asOf>from&&asOf<=to&&Number.isFinite(forecast?.model?.return);
 let cumulative=periodDays(from,to)>1;
 if(valid)for(let d=shiftDate(from,1);d<to;d=shiftDate(d,1))if(session(d,'CN').reason==='交易所节假日休市')cumulative=true;
 return {from:from??expected,to,asOf:asOf??null,return:valid?forecast.model.return:null,referenceOnly:!!reference,
  mode:cumulative?'cumulative':'daily',partial,provisional:!!forecast?.base?.provisional,
  status:record.actual?'published':partial?'accumulating':record.sealedAt?'sealed':'pending',targetConfirmed:fund.plan?.targetConfirmed!==false,
  value:valid?forecast.model.value:null,calculatedAt:forecast?.calculatedAt??null};
}
export function reconcileObservation(previous,candidate,actual,now,{target,asOf=target,reviseHoldings=false}){
 const next=candidate?{...candidate,date:target,asOf}:null;
 if(asOf<target){
  if(actual)return {...previous,...reconcile(previous,null,actual,now)};
  if(previous?.actual||previous?.sealedAt)return previous;
  if(!next||previous?.partialForecast?.asOf>asOf)return previous??{};
  return captureStage({...previous,partialForecast:next,firstPartialAt:previous?.firstPartialAt??now,updatedAt:now},next,target,now);
 }
 // Normal refreshes keep the sealed snapshot. A successful holdings sync may
 // replace an unpublished forecast, while reconcile retains originalForecast.
 const revision=!!(reviseHoldings&&previous?.forecast&&!previous.actual&&!actual
  &&next?.model?.value>0&&Number.isFinite(next.model.return)&&!next.referenceOnly&&!next.base?.provisional
  &&next.base?.date===(next.valuationBaseDate??previousNavDate(target)));
 const frozen=previous?.sealedAt&&previous.forecast&&!revision;
 const result={...previous,...reconcile(previous,frozen?null:next,actual,now)};
 if(revision){delete result.sealedAt;result.forecastRevisedAt=now;result.forecastRevisionReason='holdings-change';}
 if(!session(target,'CN').closed&&result.forecast&&!result.forecast.referenceOnly&&!result.forecast.base?.provisional&&!result.sealedAt&&!actual
   &&result.forecast.date===target&&result.forecast.base?.date===(next?.valuationBaseDate??previousNavDate(target)))result.sealedAt=now;
 return captureStage(result,frozen?null:next,target,now);
}
export function navSnapshot(known,target,record={}){
 return {...known,date:target,record,indexQuote:record.indexClose??null,analysis:null,quality:null,challenger:null,modelError:null,error:null,cumulativeWindow:undefined};
}
