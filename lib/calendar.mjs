// Scheduled cash-equity closures; US 2026-2028 and JP 2026-2027 rechecked
// 2026-10-15 against NYSE and JPX calendars. Unknown years/markets
// never authorize carrying a quote across a missing weekday. See docs/calendar-sources.md.
const holidays={
 US:{'2026':'01-01 01-19 02-16 04-03 05-25 06-19 07-03 09-07 11-26 12-25',
     '2027':'01-01 01-18 02-15 03-26 05-31 06-18 07-05 09-06 11-25 12-24',
     '2028':'01-17 02-21 04-14 05-29 06-19 07-04 09-04 11-23 12-25'},
 HK:{'2026':'01-01 02-17 02-18 02-19 04-03 04-06 04-07 05-01 05-25 06-19 07-01 10-01 10-19 12-25'},
 CN:{'2026':'01-01 01-02 02-16 02-17 02-18 02-19 02-20 02-23 04-06 05-01 05-04 05-05 06-19 09-25 10-01 10-02 10-05 10-06 10-07'},
 JP:{'2026':'01-01 01-02 01-12 02-11 02-23 03-20 04-29 05-04 05-05 05-06 07-20 08-11 09-21 09-22 09-23 10-12 11-03 11-23 12-31',
     '2027':'01-01 01-02 01-03 01-11 02-11 02-23 03-21 03-22 04-29 05-03 05-04 05-05 07-19 08-11 09-20 09-23 10-11 11-03 11-23 12-31'}
};
const early={US:{'2026':{'11-27':13,'12-24':13},'2027':{'11-26':13},'2028':{'07-03':13,'11-24':13}},HK:{'2026':{'02-16':13,'12-24':13,'12-31':13}}};
const zones={US:'America/New_York',HK:'Asia/Hong_Kong',CN:'Asia/Shanghai',JP:'Asia/Tokyo',KR:'Asia/Seoul'};
const closeHours={US:16,HK:16,CN:15,JP:16,KR:16}; // Conservative Asian close buffer retained.
export function marketId(secid){return {'105':'US','106':'US','107':'US','116':'HK','0':'CN','1':'CN','176':'JP','177':'KR'}[secid?.split('.')[0]];}
export function shiftDate(date,days){return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
export function session(date,market){
 const weekend=[0,6].includes(new Date(date+'T12:00:00Z').getUTCDay());
 const year=date.slice(0,4);
 const known=Object.hasOwn(holidays,market)&&Object.hasOwn(holidays[market],year);
 const holiday=known&&holidays[market][year].split(' ').includes(date.slice(5));
 return {closed:weekend||holiday,known:weekend||known,reason:weekend?'周末休市':holiday?'交易所节假日休市':known?'交易日':'节假日日历未覆盖',closeHour:known?(early[market]?.[year]?.[date.slice(5)]??closeHours[market]):closeHours[market]};
}
export function expectedCloseDate(date,market){
 let d=date;
 for(let i=0;i<20;i++,d=shiftDate(d,-1)){
  if(!session(d,market).closed)return d;
 }
 return null;
}
export function quoteDateMatches(quoteDate,date,market){
 return !!market&&!!quoteDate&&quoteDate===expectedCloseDate(date,market);
}
export function marketStatus(date,market,now=new Date()){
 const s=session(date,market);
 const zone=zones[market];if(!zone)return {...s,state:'unknown',message:'未知市场，无法确认收盘'};
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 const local=`${p.year}-${p.month}-${p.day}`;
 if(date>local)return {...s,state:'pending',message:'尚未到目标交易日'};
 if(s.closed)return {...s,state:'closed',message:s.reason};
 if(date===local&&Number(p.hour)<s.closeHour+1)return {...s,state:'pending',message:'尚未确认收盘（含行情缓冲时间）'};
 return {...s,state:'complete',message:s.known?'已过收盘时间':'已过常规收盘时间；节假日日历未覆盖'};
}
export function canUseBar(bar,date,market,now=new Date()){
 return quoteDateMatches(bar?.date,date,market)&&marketStatus(bar.date,market,now).state==='complete';
}
