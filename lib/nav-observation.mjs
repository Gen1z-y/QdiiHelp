import {expectedCloseDate,shiftDate,session,marketStatus} from './calendar.mjs';
import {chinaDate,validDate,previousWeekday,reconcile} from './model.mjs';
export function previousNavDate(date){return expectedCloseDate(shiftDate(date,-1),'CN');}
export function observationPlan(now=new Date()){
 // A string is a Beijing daytime snapshot, useful for date-only callers.
 if(typeof now==='string')now=new Date(now+'T12:00:00+08:00');
 let asOf=previousWeekday(now);
 for(let i=0;i<20;i++){
  if(['US','HK','JP','CN'].every(m=>marketStatus(asOf,m,now).state!=='pending'))break;
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
export function navEstimate(fund){
 const record=fund.record??{},forecast=record.forecast??(!record.actual?record.partialForecast:null);
 const from=forecast?.base?.date,to=fund.date,asOf=forecast?.asOf??forecast?.date;
 const expected=record.actual?.previousDate??(validDate(to)?previousNavDate(to):null);
 const partial=!!forecast&&asOf<to;
 const valid=validDate(to)&&!session(to,'CN').closed&&forecast?.date===to&&from===expected
  &&validDate(asOf)&&asOf>from&&asOf<=to&&Number.isFinite(forecast?.model?.return);
 let cumulative=false;
 if(valid)for(let d=shiftDate(from,1);d<to;d=shiftDate(d,1))if(session(d,'CN').reason==='交易所节假日休市')cumulative=true;
 return {from:from??expected,to,asOf:asOf??null,return:valid?forecast.model.return:null,
  mode:cumulative?'cumulative':'daily',partial,provisional:!!forecast?.base?.provisional,
  status:record.actual?'published':partial?'accumulating':record.sealedAt?'sealed':'pending',
  value:valid?forecast.model.value:null,calculatedAt:forecast?.calculatedAt??null};
}
export function reconcileObservation(previous,candidate,actual,now,{target,asOf=target}){
 const next=candidate?{...candidate,date:target,asOf}:null;
 if(asOf<target){
  if(actual)return {...previous,...reconcile(previous,null,actual,now)};
  if(previous?.actual||previous?.sealedAt)return previous;
  if(!next||previous?.partialForecast?.asOf>asOf)return previous??{};
  return {...previous,partialForecast:next,firstPartialAt:previous?.firstPartialAt??now,updatedAt:now};
 }
 // Keep the original close snapshot, even on a forced recalculation.
 const frozen=previous?.sealedAt&&previous.forecast;
 const result={...previous,...reconcile(previous,frozen?null:next,actual,now)};
 if(!session(target,'CN').closed&&result.forecast&&!result.forecast.base?.provisional&&!result.sealedAt&&!actual
   &&result.forecast.date===target&&result.forecast.base?.date===previousNavDate(target))result.sealedAt=now;
 return result;
}
export function navSnapshot(known,target,record={}){
 return {...known,date:target,record,indexQuote:record.indexClose??null,analysis:null,quality:null,challenger:null,modelError:null,error:null,cumulativeWindow:undefined};
}
