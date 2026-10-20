import {calendarCoverage} from '../lib/calendar-maintenance.mjs';
import {session} from '../lib/calendar.mjs';
const date=process.argv[2]??new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))throw Error('日期格式必须是 YYYY-MM-DD');
for(const entry of calendarCoverage(date)){
 for(const year of entry.years)if(!session(year+'-06-10',entry.market).known)throw Error('日历来源声明与实际覆盖不一致：'+entry.market+' '+year);
 console.log(entry.name+'：'+(entry.years.join('、')||'未覆盖')+'；'+(entry.warning??'当前年份已覆盖')+'；核验 '+(entry.verifiedAt??'尚未完整核验')+'；'+entry.url);
}
// Missing calendars are warnings, never an instruction to fabricate holidays.
