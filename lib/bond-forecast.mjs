import {bondReference,usableBondReference} from './bond-reference.mjs';
import {marketStatus,session} from './calendar.mjs';
import {previousNavDate} from './nav-observation.mjs';

// Close-only bond estimate. Intraday index values stay a display reference;
// the formal forecast exists only after the CN session is confirmed complete
// (with the usual one-hour quote buffer), so it seals hours before the fund
// company publishes the same evening's NAV and can be scored against it.
// Single-day only: the base must be the previous CN trading day's published
// NAV, so holiday-gap intervals never become a bond forecast.
export const BOND_MODEL='bond-fit-v1';
export async function bondFitForecast(target,{history,base,now=new Date(),reference=bondReference}={}){
 if(session(target,'CN').closed)return {candidate:null,unavailable:'国内休市，不生成债基预估'};
 const gate=usableBondReference(target,null,now);if(gate)return {candidate:null,unavailable:gate.unavailable+'，不生成债基预估'};
 if(marketStatus(target,'CN',now).state!=='complete')return {candidate:null,unavailable:'等待A股收盘确认后生成正式预估，盘中数值仅供参考'};
 if(!base||base.provisional||!(base.value>0))return {candidate:null,unavailable:'缺少早于目标日的正式净值基准'};
 if(base.date!==previousNavDate(target))return {candidate:null,unavailable:'净值基准不是前一交易日，暂不做跨多日的债基预估'};
 const ref=await reference(target,{history,now});
 if(!ref||!Number.isFinite(ref?.return))return {candidate:null,unavailable:ref?.unavailable??'债券指数拟合暂不可用'};
 if(ref.carried||ref.indexDate!==target)return {candidate:null,unavailable:'目标日缺少国债指数收盘行情'};
  const value=base.value*(1+ref.return);
 return {candidate:{date:target,base:{date:base.date,value:base.value},
   model:{return:ref.return,dailyReturn:ref.return,value,method:BOND_MODEL},
   fit:{coeffs:ref.coeffs,factors:ref.factors,samples:ref.samples,r2:ref.r2},
   calculatedAt:now.toISOString()},ref};
}
