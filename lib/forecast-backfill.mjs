import {estimateMarket} from './model.mjs';
import {holdingDateIssue} from './estimation-rules.mjs';
import {forecastIssue} from './forecast-policy.mjs';
import {marketStatus} from './calendar.mjs';
import {mapLimit} from './provider.mjs';

// Retrospective estimates are separate from forecasts/evidence used for accuracy.
export async function reconstructForecast({date,name,holdings,nav,rowWithPrices,now=new Date()}){
 if(marketStatus(date,'US',now).state!=='complete')throw new Error('目标交易日尚未完成收盘或休市');
 const issue=holdingDateIssue(holdings?.asOf,date);if(issue)throw new Error(issue);
 const base=nav.filter(n=>n.date<date).sort((a,b)=>b.date.localeCompare(a.date))[0];
 if(!base)throw new Error('缺少早于目标日期的正式净值基准');
 const rows=await mapLimit(holdings.rows.filter(r=>r.weight>0),row=>rowWithPrices(row,base.date,date),2);
 const candidate={date,base,holdingsDate:holdings.asOf,rows,model:{...estimateMarket(base,rows),method:'market-close-v4'},calculatedAt:now.toISOString()};
 const error=forecastIssue(candidate,name);if(error)throw new Error(error);
 return {date,dailyReturn:candidate.model.dailyReturn,coverage:candidate.model.coverage,holdingsDate:holdings.asOf,baseDate:base.date,calculatedAt:now.toISOString(),method:'historical-backfill-v1'};
}
