// Coverage and provenance are deliberately separate from live market data.
export const calendarSources={
 US:{name:'美国',years:[2026,2027,2028],verifiedAt:'2026-10-15',url:'https://www.nyse.com/trade/hours-calendars'},
 JP:{name:'日本',years:[2026,2027],verifiedAt:'2026-10-15',url:'https://www.jpx.co.jp/english/corporate/about-jpx/calendar/index.html'},
 HK:{name:'香港',years:[2026],verifiedAt:'2026-10-02',url:'https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2025/ce_SEHK_CT_075_2025.pdf'},
 CN:{name:'内地',years:[2026],verifiedAt:'2026-10-02',url:'https://www.sse.com.cn/disclosure/dealinstruc/closed/c/c_20251222_10802510.shtml'},
 KR:{name:'韩国',years:[],verifiedAt:null,url:'https://global.krx.co.kr/main/main.jsp'}
};
export function calendarCoverage(date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())){
 const year=Number(date.slice(0,4)),daysToNextYear=(Date.parse((year+1)+'-01-01')-Date.parse(date))/86400000;
 return Object.entries(calendarSources).map(([market,source])=>({market,...source,currentYear:year,covered:source.years.includes(year),nextYearCovered:source.years.includes(year+1),
  warning:!source.years.includes(year)?'当前年份日历未覆盖；缺行情不推断休市':daysToNextYear<=90&&!source.years.includes(year+1)?'距跨年不足90天，下一年安排待核验':null}));
}
