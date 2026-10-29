import {previousWeekday,validDate} from './model.mjs';
import {usableFx} from './provider.mjs';
import {marketId,marketStatus,quoteDateMatches,session,expectedCloseDate,shiftDate} from './calendar.mjs';
import {holdingDateIssue} from './estimation-rules.mjs';
import {MIN_BOND_SAMPLES,MIN_BOND_R2} from './bond-reference.mjs';
import {adaptiveFitReturn,pureBondDisclosure,BOND_VALIDATION_DAYS} from './bond-adaptive.mjs';
import {disclosureAt} from './bond-disclosure.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// forecastIssue is deterministic in (forecast, name, rule code), so validated
// entries are stamped with a fingerprint of every rule-relevant module and
// later startups only re-check unstamped ones. Editing any rule module changes
// the fingerprint and forces one full sweep; runtime-written forecasts were
// already validated by this same code version before being saved.
const libDir=path.dirname(fileURLToPath(import.meta.url));
export const FORECAST_POLICY_VERSION=createHash('sha256')
 .update(fs.readFileSync(path.join(libDir,'forecast-policy.mjs')))
 .update(fs.readFileSync(path.join(libDir,'calendar.mjs')))
 .update(fs.readFileSync(path.join(libDir,'estimation-rules.mjs')))
 .update(fs.readFileSync(path.join(libDir,'bond-adaptive.mjs')))
 .update(fs.readFileSync(path.join(libDir,'bond-disclosure.mjs')))
 .update(fs.readFileSync(path.join(libDir,'model.mjs')))
 .update(fs.readFileSync(path.join(libDir,'provider.mjs')))
 .update(fs.readFileSync(path.join(libDir,'bond-reference.mjs')))
 .update(fs.readFileSync(path.join(libDir,'bond-forecast.mjs')))
 .digest('hex').slice(0,16);

// Conservative close-only policy. Unverified holiday carry is not a daily forecast.
export function forecastIssue(forecast,name='') {
 if(!forecast)return '没有预测';
 if(validDate(forecast.date)&&[0,6].includes(new Date(forecast.date+'T12:00:00Z').getUTCDay()))return '周末不生成单日预估';
 if(['market-close-v2','index-proxy-v2','market-close-v3','index-proxy-v3','market-close-v4'].includes(forecast.model?.method)){
  const {date,base,model,rows,indexQuote:q,fx}=forecast;
  if(/债/.test(name))return '债基不预估';
  if(!validDate(date)||!validDate(base?.date)||base.date>=date||!(base.value>0))return '缺少净值基准';
  if(!Number.isFinite(model.return)||!Number.isFinite(model.dailyReturn)||!(model.value>0))return '没有可用收盘行情';
  if(model.method.startsWith('index-proxy-')){
   const v3=model.method==='index-proxy-v3';
   if(!['NDX','SPX'].includes(q?.id)||q.stale||(v3?!quoteDateMatches(q.date,date,'US'):q.date!==date)||!validDate(q.baseDate)||q.baseDate>base.date||!(q.baseClose>0))return '指数收盘日期不匹配';
   if(v3&&(!quoteDateMatches(q.baseDate,base.date,'US')||q.valuationPreviousDate!==previousWeekday(new Date(date+'T12:00:00Z'))||!quoteDateMatches(q.valuationPreviousQuoteDate,q.valuationPreviousDate,'US')||!(q.valuationPreviousClose>0)))return '指数基准收盘日期不匹配';
   if(!usableFx(fx,base.date,date)||!usableFx(forecast.dailyFx,v3?q.valuationPreviousDate:q.previousDate,date))return '指数汇率不可用';
  }else{
   if(/联接|指数/.test(name))return '尚未接入对应指数，暂停股票持仓估算';
   const holdingIssue=holdingDateIssue(forecast.holdingsDate,date);if(holdingIssue)return holdingIssue;
   // A holiday carry from one market cannot stand in for other markets yet to close.
   const captured=forecast.calculatedAt?new Date(forecast.calculatedAt):null;
   if(rows?.some(r=>r.weight>0&&(r.marketStatus?.state==='pending'||(captured&&Number.isFinite(captured.getTime())&&marketId(r.secid)&&marketStatus(date,marketId(r.secid),captured).state==='pending'))))return '等待持仓市场收盘，暂不生成当日预估';
   const usable=rows?.filter(r=>Number.isFinite(r.rmbReturn));
   const v3=['market-close-v3','market-close-v4'].includes(model.method);
   if(!usable?.length||usable.some(r=>(v3?!quoteDateMatches(r.stock?.target?.date,date,marketId(r.secid)):r.stock?.target?.date!==date)||!validDate(r.stock?.base?.date)||r.stock.base.date>base.date||!Number.isFinite(r.dailyRmbReturn)))return '等待有效收盘行情';
   if(v3&&usable.some(r=>!quoteDateMatches(r.stock.base.date,base.date,marketId(r.secid))||r.dailyBaseDate!==previousWeekday(new Date(date+'T12:00:00Z'))||!quoteDateMatches(r.dailyStock?.base?.date,r.dailyBaseDate,marketId(r.secid))||!quoteDateMatches(r.dailyStock?.target?.date,date,marketId(r.secid))||(r.currency!=='CNY'&&!usableFx(r.dailyFx,r.dailyBaseDate,date))))return '单日行情或汇率基准不匹配';
   if(usable.some(r=>r.currency!=='CNY'&&!usableFx(r.fx,base.date,date)))return '汇率不可用';
  }
  return null;
 }
 if(forecast.model?.method==='index-proxy-v1'){
  const {date,base,indexQuote:q,fx}=forecast;
  if(!validDate(date)||!validDate(base?.date)||!(base.value>0))return '指数预估缺少净值基准';
  if(!['NDX','SPX'].includes(q?.id)||q.stale||q.date!==date||q.previousDate!==base.date)return '指数收盘日期与净值基准不匹配';
  if(fx?.base?.date!==base.date||fx?.target?.date!==date||!Number.isFinite(fx.return))return '指数预估缺少对应日期汇率';
  const expected=(1+q.dailyReturn)*(1+fx.return)-1;
  if(!Number.isFinite(expected)||!Number.isFinite(forecast.model.return)||Math.abs(expected-forecast.model.return)>1e-10||!(forecast.model.value>0))return '指数预估无效';
  return null;
 }
 if(forecast.model?.method==='bond-fit-v2'){
  const {date,base,model,fit}=forecast;
  if(!validDate(date)||!validDate(base?.date)||!(base.value>0)||base.provisional)return '缺少正式净值基准';
  if(session(date,'CN').closed)return '国内休市不生成债基预估';
  const captured=forecast.calculatedAt?new Date(forecast.calculatedAt):null;
  if(!captured||Number.isNaN(captured.getTime())||marketStatus(date,'CN',captured).state!=='complete')return '债基预估须在A股收盘确认后生成';
  if(base.date!==expectedCloseDate(shiftDate(date,-1),'CN'))return '缺少前一交易日基准，区间涨跌不能作为单日预测';
  const v=fit?.validation,d=fit?.disclosure;
  if(!pureBondDisclosure(disclosureAt([d],date))||!(fit?.samples>=MIN_BOND_SAMPLES)||!(fit?.r2>=MIN_BOND_R2)
   ||v?.count!==BOND_VALIDATION_DAYS||!validDate(v.from)||!validDate(v.to)||v.from>v.to||v.to>=date||v.unit!=='return'
   ||![v.baselineMae,v.candidateMae,v.baselineWorst,v.candidateWorst,v.recentBaselineMae,v.recentCandidateMae].every(x=>Number.isFinite(x)&&x>=0)
   ||!(v.candidateMae<v.baselineMae*.95&&v.candidateWorst<=v.baselineWorst*1.1&&v.recentCandidateMae<=v.recentBaselineMae*1.05))return '持仓约束债基拟合验证不完整';
  const expected=adaptiveFitReturn(fit,date);
  if(expected===null||!Number.isFinite(model?.return)||Math.abs(model.return-expected)>1e-9||model.dailyReturn!==model.return||!(model.value>0)||Math.abs(model.value-base.value*(1+model.return))>base.value*1e-9)return '持仓约束债基预估无效';
  return null;
 }
 if(forecast.model?.method==='bond-fit-v1'){
  const {date,base,model,fit}=forecast;
  if(!validDate(date)||!validDate(base?.date)||!(base.value>0))return '缺少净值基准';
  if(session(date,'CN').closed)return '国内休市不生成债基预估';
  const captured=forecast.calculatedAt?new Date(forecast.calculatedAt):null;
  if(!captured||Number.isNaN(captured.getTime())||marketStatus(date,'CN',captured).state!=='complete')return '债基预估须在A股收盘确认后生成';
  if(base.date!==expectedCloseDate(shiftDate(date,-1),'CN'))return '缺少前一交易日基准，区间涨跌不能作为单日预测';
  if(!(fit?.samples>=MIN_BOND_SAMPLES)||!(fit?.r2>=MIN_BOND_R2)||!Array.isArray(fit.coeffs)||fit.coeffs.length!==4||!fit.coeffs.every(Number.isFinite))return '债券指数拟合输入不完整';
  const fs=fit.factors;
  if(!Array.isArray(fs)||fs.length!==3||fs.some(f=>f.date!==date||f.carried||!Number.isFinite(f.dayReturn)))return '债券指数拟合输入不完整';
  const [t,cr,cv]=fs.map(f=>f.dayReturn);
  const expected=fit.coeffs[0]+fit.coeffs[1]*t+fit.coeffs[2]*(cr-t)+fit.coeffs[3]*(cv-t);
  if(!Number.isFinite(model?.return)||Math.abs(model.return-expected)>1e-9||model.dailyReturn!==model.return||!(model.value>0)||Math.abs(model.value-base.value*(1+model.return))>base.value*1e-9)return '债基拟合预估无效';
  return null;
 }
 if(/联接|指数/.test(name))return '指数及ETF联接基金尚未接入对应指数或目标ETF估值，暂停股票持仓估算';
 const {date,base,holdingsDate,rows}=forecast;
 if(!validDate(date)||!validDate(base?.date))return '预测日期或基准日缺失';
 const holdingIssue=holdingDateIssue(holdingsDate,date);if(holdingIssue)return holdingIssue;
 if(base.date!==previousWeekday(new Date(date+'T12:00:00Z')))return '缺少前一工作日基准，区间涨跌不能作为单日预测';
 if(!rows?.length)return '缺少行情明细';
 const usable=rows.filter(r=>Number.isFinite(r.rmbReturn));
 if(!usable.length)return '没有可用收盘行情';
 if(usable.some(r=>r.stock?.target?.date!==date||r.stock?.base?.date!==base.date))return '等待目标日收盘：股票日期不一致，不能沿用旧行情估算';
 if(usable.some(r=>r.currency!=='CNY'&&(!r.fx?.target||r.fx.target.date!==date||r.fx.base?.date!==base.date)))return '目标日或基准日汇率缺失，暂不输出预测';
 if(!Number.isFinite(forecast.model?.return)||forecast.model?.value==null)return '有效行情覆盖不足，暂不输出预测';
 return null;
}

// Returns true only when an entry was actually invalidated; stamping alone is
// reported through stats.stamped so the caller can persist marks without
// treating them as a policy fix.
export function invalidateForecasts(data,stats={}){
 let changed=false;
 for(const [key,r] of Object.entries(data.records||{})){
  // Expired inputs cannot revalidate historical summaries; retain the saved outcome.
  if(r.detailsCompactedAt)continue;
  if(r.policyChecked===FORECAST_POLICY_VERSION)continue;
  stats.stamped=true;r.policyChecked=FORECAST_POLICY_VERSION;
  if(!r.forecast)continue;
  const name=Object.values(data.lastView||{}).find(v=>v.code===key.slice(0,6))?.name||'';
  const reason=forecastIssue(r.forecast,name);
  if(reason){r.rejectedForecasts??=[];r.rejectedForecasts.push({forecast:r.forecast,reason,invalidatedAt:new Date().toISOString()});r.forecast=null;r.firstForecastAt=null;changed=true;}
 }
 for(const [key,v] of Object.entries(data.lastView||{})){
  const r=data.records?.[key];if(r)v.record=r;
  if(v.policyChecked===FORECAST_POLICY_VERSION)continue;
  stats.stamped=true;v.policyChecked=FORECAST_POLICY_VERSION;
  if(v.analysis&&!v.analysis.diagnostic){const reason=forecastIssue(v.analysis,v.name);if(reason){v.analysis=null;v.modelError=reason;changed=true;}}
 }
 for(const [key,r] of Object.entries(data.incomeRecords||{})){
  if(r.estimated==null)continue;
  const f=data.records?.[key]?.forecast;
  if(!f||forecastIssue(f)){
   data.rejectedIncomeRecords??=[];data.rejectedIncomeRecords.push({...r,reason:'预测日期、持仓或模型校验未通过'});
   if(r.actual!=null){r.estimated=null;r.profit=r.actual;r.source='actual';}else delete data.incomeRecords[key];
   changed=true;
  }
 }
 return changed;
}
