import {estimateMarket} from './model.mjs';
import {estimateMarketIndex} from './indices.mjs';
import {adaptiveFitReturn} from './bond-adaptive.mjs';

// Recompute sealed forecasts from their stored inputs: a mismatch means the
// stored model no longer reproduces from its own rows/quotes (corruption or a
// changed model function), never a re-prediction of anything.
export function replayForecast(forecast){
 if(forecast?.detailsOmitted)return null;
 const method=forecast?.model?.method;
 if(!method)return null;
 if(method==='market-close-v4'||method==='market-close-v3'||method==='market-close-v2'){
  if(!forecast.rows?.length||!forecast.base)return null;
  return estimateMarket(forecast.base,forecast.rows);
 }
 if(method.startsWith('index-proxy')){
  if(!forecast.indexQuote||!forecast.base||!forecast.fx||!forecast.dailyFx)return null;
  return estimateMarketIndex(forecast.date,forecast.base,forecast.indexQuote,forecast.fx,forecast.dailyFx).model??null;
 }
 if(method==='bond-fit-v2'){
  const ret=adaptiveFitReturn(forecast.fit,forecast.date);
  return ret!==null&&forecast.base?.value>0?{return:ret,dailyReturn:ret,value:forecast.base.value*(1+ret)}:null;
 }
 if(method==='bond-fit-v1'){
  const {fit,base}=forecast;
  const fs=fit?.factors;
  if(!fit||!base||!(base.value>0)||!Array.isArray(fit.coeffs)||fit.coeffs.length!==4||!fit.coeffs.every(Number.isFinite)
   ||!Array.isArray(fs)||fs.length!==3||!fs.every(f=>Number.isFinite(f.dayReturn)))return null;
  const [t,cr,cv]=fs.map(f=>f.dayReturn);
  const ret=fit.coeffs[0]+fit.coeffs[1]*t+fit.coeffs[2]*(cr-t)+fit.coeffs[3]*(cv-t);
  return {return:ret,dailyReturn:ret,value:base.value*(1+ret)};
 }
 return null;
}
export function replaySealedForecasts(data,{limit=5,now=new Date()}={}){
 const sealed=Object.entries(data.records??{})
  .filter(([,r])=>!r.detailsCompactedAt&&r.sealedAt&&r.forecast?.model)
  .sort((a,b)=>(b[1].sealedAt??'').localeCompare(a[1].sealedAt??''))
  .slice(0,limit);
 const mismatches=[];
 for(const [key,r] of sealed){
  const replayed=replayForecast(r.forecast);
  if(!replayed)continue;
  const saved=r.forecast.model;
  const bad=['return','dailyReturn','coverage','value'].some(k=>
   Number.isFinite(saved[k])!==Number.isFinite(replayed[k])||
   (Number.isFinite(saved[k])&&Math.abs(saved[k]-replayed[k])>1e-9));
  if(bad)mismatches.push({key,sealedAt:r.sealedAt,saved:{return:saved.return??null,dailyReturn:saved.dailyReturn??null},replayed:{return:replayed.return??null,dailyReturn:replayed.dailyReturn??null}});
 }
 return {checkedAt:now.toISOString(),checked:sealed.length,mismatches};
}
