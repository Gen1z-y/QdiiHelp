import {shiftDate} from './calendar.mjs';
import {validDate} from './model.mjs';

export function cumulativeWindow(fund){
 const p=fund.record?.forecast,base=p?.base?.date,target=fund.date;
 const none={show:false,from:base??null,to:target??null,weekdays:0};
 if(!validDate(base)||!validDate(target)||base>=target||!Number.isFinite(p?.model?.return))return none;
 if([0,6].includes(new Date(target+'T12:00:00Z').getUTCDay()))return none;
 if(fund.record?.actual||fund.latestNav?.date>=target)return none;
 let weekdays=0;
 for(let date=shiftDate(base,1),i=0;date<=target&&i<366;i++,date=shiftDate(date,1)){
  const day=new Date(date+'T12:00:00Z').getUTCDay();
  if(day===0||day===6)continue;
  weekdays++;
 }
 // Elapsed weekdays alone are insufficient: prices or FX must have updated.
 const updated=(p.rows??[]).some(r=>r.stock?.target?.date>base||r.fx?.target?.date>base)
  ||p.indexQuote?.date>base||p.fx?.target?.date>base;
 return {...none,show:weekdays>1&&updated,weekdays};
}
