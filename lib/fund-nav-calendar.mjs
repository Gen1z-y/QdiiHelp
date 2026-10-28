import {session,shiftDate} from './calendar.mjs';
import {comparableNavPair} from './nav-publication.mjs';

// Fund-specific non-open days, verified against the manager's 2026 notice.
// CN exchange holidays/weekends are handled by calendar.mjs. Do not infer
// another fund's valuation calendar from its holdings or its share-class name.
const emerging2026={
 source:'https://fund.eastmoney.com/gonggao/018147,AN202512301811063793.html',
 days:{'01-19':'马丁路德金纪念日','04-03':'耶稣受难节','04-07':'复活节',
  '05-25':'美国阵亡将士纪念日、香港佛诞日','07-01':'香港特别行政区成立纪念日',
  '07-03':'美国独立日','09-07':'美国劳动节','10-19':'重阳节','11-26':'美国感恩节','12-25':'圣诞节'}
};
const calendars={'018147':{'2026':emerging2026},'539002':{'2026':emerging2026}};

// A non-open notice is evidence about subscriptions, not proof of no valuation.
export function fundCalendarDay(code,date,rule=null){
 const cn=session(date,'CN'),calendar=calendars[code]?.[date?.slice(0,4)];
 const nonOpenReason=calendar?.days[date?.slice(5)]??null;
 const explicit=rule?.source&&rule?.from<=date&&rule?.to>=date;
 const noValuation=!!(explicit&&rule.nonValuationDates?.includes(date));
 const specialValuation=!!(explicit&&rule.valuationDates?.includes(date));
 return {closed:!specialValuation&&(cn.closed||noValuation),known:cn.known,
  noValuation,nonOpen:!!nonOpenReason,uncertain:!!nonOpenReason&&!noValuation&&!specialValuation,
  reason:noValuation?'基金公告当日不估值':nonOpenReason??cn.reason,
  source:explicit?rule.source:nonOpenReason?calendar.source:null,specialValuation};
}

export function previousFundDate(code,date,rule=null){
 for(let d=shiftDate(date,-1),i=0;i<366;i++,d=shiftDate(d,-1)){
  const day=fundCalendarDay(code,d,rule);
  if(!day.closed&&(!day.nonOpen||day.specialValuation))return d;
 }
 return null;
}

export function fundNavPeriod(code,from,to){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from??'')||!/^\d{4}-\d{2}-\d{2}$/.test(to??'')||from>=to)return null;
 const calendar=calendars[code]?.[to.slice(0,4)];
 if(!calendar||from.slice(0,4)!==to.slice(0,4)||Date.parse(to)-Date.parse(from)>32*86400000)return null;
 if(session(from,'CN').closed||session(to,'CN').closed||calendar.days[from.slice(5)]||calendar.days[to.slice(5)])return null;
 const reasons=new Set();
 for(let d=shiftDate(from,1);d<to;d=shiftDate(d,1)){
  if(session(d,'CN').closed)continue;
  const reason=calendar.days[d.slice(5)];
  if(!reason)return null; // A real missing open day must stay a data gap.
  reasons.add(reason);
 }
 return reasons.size?{returnPeriod:'fund-valuation',returnReason:[...reasons].join('、'),returnCalendarSource:calendar.source}:null;
}

export function supplementFundNavReturn(code,rows){
 const row=rows[0],prior=rows[1];
 if(!comparableNavPair(row,prior)||Number.isFinite(row.dailyReturn))return rows;
 const period=fundNavPeriod(code,prior.date,row.date);
 if(!period)return rows;
 const calculated=row.value/prior.value-1;
 if(Number.isFinite(row.intervalReturn)&&Math.abs(row.intervalReturn-calculated)>1e-6)return rows;
 // This is a return between successive published valuations, not one CN day.
 // Preserve dailyReturn=null so daily charts/error statistics cannot mix bases.
 return [{...row,intervalReturn:row.intervalReturn??calculated,returnFrom:prior.date,returnTo:row.date,
  returnSource:row.returnSource??'公布净值计算',...period},...rows.slice(1)];
}
