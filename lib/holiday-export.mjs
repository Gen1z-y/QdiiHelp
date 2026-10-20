import {session,shiftDate,marketStatus} from './calendar.mjs';
import {chinaDate} from './model.mjs';

// A contiguous CN closure must contain a weekday holiday; ordinary weekends
// must never activate the holiday layout. Unknown calendars stay ordinary.
export function holidayWindow(today=chinaDate()){
 if(!session(today,'CN').closed)return null;
 let start=today,end=today;
 for(let i=0;i<20&&session(shiftDate(start,-1),'CN').closed;i++)start=shiftDate(start,-1);
 for(let i=0;i<20&&session(shiftDate(end,1),'CN').closed;i++)end=shiftDate(end,1);
 const dates=[];let hasHoliday=false;
 for(let d=start;d<=end;d=shiftDate(d,1)){
  if(session(d,'CN').reason==='交易所节假日休市')hasHoliday=true;
  if(![0,6].includes(new Date(d+'T12:00:00Z').getUTCDay()))dates.push(d);
 }
 return hasHoliday?{start,end,dates}:null;
}

export const exportable=f=>f.code!=='019305'&&!f.bond&&!f.index&&!f.indexQuote&&!/债|联接|指数/.test(f.name??'');
export function forecastHistory(records,code){
 return Object.entries(records).filter(([key])=>key.startsWith(code+':')).map(([key,r])=>({
  date:key.slice(7),value:Number.isFinite(r.forecast?.model?.dailyReturn)?r.forecast.model.dailyReturn:r.reconstruction?.dailyReturn??null,
  reconstructed:!Number.isFinite(r.forecast?.model?.dailyReturn)&&Number.isFinite(r.reconstruction?.dailyReturn),
  actual:Number.isFinite(r.actual?.dailyReturn)?r.actual.dailyReturn:null,
  capturedAt:r.forecast?.calculatedAt??r.firstForecastAt??r.reconstruction?.calculatedAt??null,
  actualSeenAt:r.firstActualSeenAt??null
 })).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,90);
}

export function compoundComplete(cells){
 if(!cells.length||cells.some(c=>!Number.isFinite(c.value)))return null;
 return cells.reduce((growth,c)=>growth*(1+c.value),1)-1;
}

export function holidayExport(funds,records,now=new Date(),fxDisplay={}){
 const today=chinaDate(now),holiday=holidayWindow(today);
 if(!holiday)return {today,holiday:null};
 const eligible=funds.filter(exportable);
 const previous=shiftDate(holiday.start,-1);
 // Keep one outstanding pre-holiday observation separately from holiday totals.
 const includePrevious=eligible.some(f=>(records[f.code+':'+previous]?.forecast||records[f.code+':'+previous]?.reconstruction)&&!records[f.code+':'+previous]?.actual);
 const dates=[...(includePrevious?[previous]:[]),...holiday.dates];
 // Global funds can include Asian markets: a date is complete only after all
 // supported markets have passed their close buffer.
 const complete=d=>['US','HK','JP','CN'].every(m=>['complete','closed'].includes(marketStatus(d,m,now).state));
 const completed=holiday.dates.filter(complete);
 const rows=eligible.map(f=>{
  const history=forecastHistory(records,f.code);
  const cells=dates.map(date=>{
   const record=history.find(r=>r.date===date),value=complete(date)?record?.value??null:null;
   return {date,value,reconstructed:!!record?.reconstructed,status:!complete(date)?'待更新':Number.isFinite(value)?'已记录':'未记录'};
  });
  const total=compoundComplete(cells.filter(c=>completed.includes(c.date)));
  return {code:f.code,name:f.name,cells,total,incomplete:completed.length>0&&total===null};
 }).sort((a,b)=>(b.total??-Infinity)-(a.total??-Infinity));
  const fxCells=dates.map(date=>{
   const fx=fxDisplay?.[date],value=Number.isFinite(fx?.dailyReturn)?fx.dailyReturn:null;
   return {date,value,status:value===null?(fx?.error?'汇率不可用':'未记录'):'已记录'};
  });
  const fxTotal=compoundComplete(fxCells.filter(c=>completed.includes(c.date)));
  const fxRow=fxCells.some(c=>c.value!==null)?{code:'汇率参考 · 人民币中间价或参考汇率',name:'美元/人民币 单日',cells:fxCells,total:fxTotal,incomplete:completed.length>0&&fxTotal===null}:null;
  return {today,holiday:{...holiday,dates,quoteDates:dates.filter(complete),previous:includePrevious?previous:null,completed,asOf:completed.at(-1)??null,fxRow},rows};
}
