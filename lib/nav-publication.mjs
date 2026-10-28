// Keep missing source fields missing; Number('') would incorrectly mean 0%.
export function navPercent(value){
 if(value==null||String(value).trim()==='')return null;
 const number=Number(value);return Number.isFinite(number)?number/100:null;
}
export function annotateNavPeriods(rows){
 return rows.map((row,i)=>{
  const prior=rows[i+1];
  return prior?{...row,previousDate:prior.date,returnFrom:row.returnFrom??prior.date,returnTo:row.date}:row;
 });
}
export function hasPublishedReturn(row){
 return !!row&&/^\d{4}-\d{2}-\d{2}$/.test(row.date??'')&&Number.isFinite(row.value)&&row.value>0
  &&(Number.isFinite(row.dailyReturn)||Number.isFinite(row.intervalReturn));
}
export function parseTencentNav(code,text){
 const parts=text.split('"')[1]?.split('~');
 if(parts?.[0]!==code||/美元|港币|现钞|现汇/.test(parts?.[1]??'')||!/^\d{4}-\d{2}-\d{2}$/.test(parts?.[8]??''))return null;
 const value=Number(parts[5]),dailyReturn=navPercent(parts[7]);
 return Number.isFinite(value)&&value>0?{date:parts[8],value,dailyReturn}:null;
}
export function comparableNavPair(row,prior){
 return !!row&&!!prior&&Number.isFinite(row.value)&&row.value>0&&Number.isFinite(prior.value)&&prior.value>0&&prior.date<row.date
  &&!row.adjustment&&!row.distribution
  &&Number.isFinite(row.cumulativeNav)&&Number.isFinite(prior.cumulativeNav)
  &&Math.abs((row.cumulativeNav-row.value)-(prior.cumulativeNav-prior.value))<=1e-7;
}
export function supplementNavReturn(rows,quote,expectedPreviousDate){
 const row=rows[0],prior=rows[1];
 if(!comparableNavPair(row,prior)||Number.isFinite(row.dailyReturn)||!quote||row.date!==quote.date||Math.abs(row.value-quote.value)>1e-8
  ||!Number.isFinite(quote.dailyReturn)||quote.dailyReturn<=-1
  ||Math.abs(row.value/prior.value-1-quote.dailyReturn)>1e-6)return rows;
 // Across a missing valuation date, expose the verified publication interval
 // separately. Never feed that interval into daily charts/calibration.
 const filled={...row,returnSource:'腾讯基金',returnFrom:prior.date,returnTo:row.date};
 if(prior.date===expectedPreviousDate)filled.dailyReturn=quote.dailyReturn;
 else filled.intervalReturn=quote.dailyReturn;
 return [filled,...rows.slice(1)];
}
export function mergePublishedNav(previous,actual){
 if(!previous||previous.date!==actual.date||previous.value!==actual.value)return actual;
 if(Number.isFinite(actual.dailyReturn))return actual;
 if(Number.isFinite(previous.dailyReturn)){
  const result={...actual,dailyReturn:previous.dailyReturn};
  for(const field of ['intervalReturn','returnSource','returnFrom','returnTo','returnPeriod','returnReason','returnCalendarSource'])delete result[field];
  if(previous.returnSource)Object.assign(result,{returnSource:previous.returnSource,returnFrom:previous.returnFrom,returnTo:previous.returnTo});
  return result;
 }
 if(!Number.isFinite(actual.intervalReturn)&&Number.isFinite(previous.intervalReturn))
  return {...actual,intervalReturn:previous.intervalReturn,returnSource:previous.returnSource,returnFrom:previous.returnFrom,returnTo:previous.returnTo,
   ...(previous.returnPeriod?{returnPeriod:previous.returnPeriod,returnReason:previous.returnReason,returnCalendarSource:previous.returnCalendarSource}:{})};
 return actual;
}
