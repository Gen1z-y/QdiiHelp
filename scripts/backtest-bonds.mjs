// Offline reconstruction only. No server, database, provider refresh or writes
// to application state. Inputs are an explicit public-data research snapshot.
import fs from 'node:fs';
import path from 'node:path';
import {bondReference,legacyBondReference} from '../lib/bond-reference.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output||!path.isAbsolute(input)||!path.isAbsolute(output)||!output.endsWith('.json')||fs.existsSync(output))throw Error('用法：node scripts/backtest-bonds.mjs 输入绝对路径.json 新报告绝对路径.json（不覆盖已有文件）');
const data=JSON.parse(fs.readFileSync(input,'utf8'));
if(!data.histories||!data.holdings||!data.series||!data.wealth)throw Error('缺少研究快照中的净值、披露或指数序列');
const results=[];
for(const [code,history] of Object.entries(data.histories)){
 const targets=history.rows.filter(r=>r.date<='2026-10-28').sort((a,b)=>a.date.localeCompare(b.date)).slice(-40),rows=[];
 const options={history,holdings:data.holdings[code],now:new Date('2026-10-29T20:00:00+08:00'),
  quote:async(s,t)=>data.series[s].filter(b=>b.date<=t),wealthQuote:async(s,t)=>data.wealth[s].filter(b=>b.date<=t)};
 for(const r of targets){
  const old=await legacyBondReference(r.date,options),next=await bondReference(r.date,options);
  rows.push({date:r.date,actual:r.dailyReturn,old:old?.return,next:next?.return,method:next?.method??'bond-fit-v1',reason:next?.adaptive?.reason,validation:next?.validation??next?.adaptive?.validation});
 }
 const valid=rows.filter(r=>Number.isFinite(r.actual)&&Number.isFinite(r.old)&&Number.isFinite(r.next));
 const mae=key=>valid.length?valid.reduce((s,r)=>s+Math.abs(r[key]-r.actual),0)/valid.length*100:null;
 results.push({code,n:valid.length,selected:valid.filter(r=>r.method==='bond-fit-v2').length,oldMae:mae('old'),newMae:mae('next'),rows});
}
const report={asOf:'2026-10-29',from:'2026-08-26',to:'2026-10-28',unit:'percentage-point',reconstructed:true,
 caveat:'使用当前公开历史数据重建，非当日封存成绩；季度报告仅从公布日之后使用。选择门槛与超参数为本次研发确定，仍需未来样本验证。',results};
fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,results:results.map(({rows,...summary})=>summary)}));
