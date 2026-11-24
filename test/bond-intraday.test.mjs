import test from 'node:test';
import assert from 'node:assert/strict';
import {bondCurveTime,loadBondCurves,parseBondCurve} from '../lib/bond-curves.mjs';
import {bondComparisonStats,captureBondComparison,captureBondTenors,estimateBondCurve,estimateBondTenors,preferBondCurve,selectBondTenor} from '../lib/bond-intraday.mjs';
import {previousNavDate} from '../lib/nav-observation.mjs';

const target='2026-11-13',previous='2026-11-12';
const clock=t=>new Date(`${target}T${t}:00+08:00`);
const row=(term,bid,mid,ask)=>['','','',String(term),'',bid,mid,ask];
function payload(date,time,mid='1.5000'){
 return {head:{rep_code:'200'},data:{date,time,dataterms:[[.1,10,29.99]],data:[row(2,'1.52',mid,'1.48'),row(30,'2.01','2.00','1.99')]},records:[{tl:30,avgYield:2}]};
}

test('银行间曲线必须匹配目标日、请求分钟并有有效双边报价',async()=>{
 assert.equal(bondCurveTime(target,clock('09:31')),null);
 assert.equal(bondCurveTime(target,clock('09:32')),'09:30');
 assert.equal(bondCurveTime(target,clock('17:06')),'17:00');
 assert.equal(bondCurveTime(target,clock('17:16')),null);
 assert.equal(bondCurveTime(previous,clock('10:00')),null);
 assert.equal(parseBondCurve(payload(previous,'10:00'),target,'10:00'),null);
 assert.equal(parseBondCurve(payload(target,'09:59'),target,'10:00'),null);
 const invalid=payload(target,'10:00');invalid.data.data.push(row(1,'2.00','','1.00'));invalid.records=[];
 assert.deepEqual(parseBondCurve(invalid,target,'10:00'),{2:.015});
 const quotes=await loadBondCurves(target,'10:00',async url=>{
  const date=url.searchParams.get('qttndate'),time=url.searchParams.get('qttntime'),type=url.searchParams.get('bondType');
  assert.ok(date===target&&time==='10:00'||date===previous&&time==='17:00');
  return {ok:true,json:async()=>type==='260101'?payload(previous,'09:00'):payload(date,time,date===target?'1.5100':'1.5000')};
 });
 assert.ok(Math.abs(quotes.government[2]-.0001)<1e-12);
 assert.deepEqual(quotes.paper,{});
});

test('逐基金使用期限、披露权重和前一日正式净值，缺关键曲线时留空',()=>{
 const asOf='2026-09-30',categories={government:20,financial:20,policy:10,corporate:5,commercialPaper:0,mtn:55,cd:10,other:0,total:110,convertible:0};
 const holdings={asOf,rows:[{code:'2600002',name:'26超长特别国债02',weight:20}],disclosures:[{schema:1,asOf,publishedAt:'2026-10-27',stockWeight:0,categories}]};
 const rows=[];
 for(let date=previous;rows.length<15;date=previousNavDate(date))rows.push({date,previousDate:previousNavDate(date),dailyReturn:.0001});
 rows.push({date:target,dailyReturn:1});
 const government={1:0,2:0,3:0,5:0,7:0,20:-.0001,30:-.0001};
 const curves={government,cdb:{1:.0001,2:.0001,3:.0001,5:.0001},mtn:{.5:0,1:0,2:.0001,3:.0001,5:.0001}};
 const args={holdings,history:{rows},base:{date:previous,value:1},curves,time:'10:30'};
 const fit=estimateBondCurve(target,args),short=estimateBondCurve(target,{...args,name:'某中短债'});
 assert.equal(fit.coverage,1);assert.equal(fit.carry,.0001);
 assert.ok(fit.contributions.find(r=>r.name==='超长国债').return>0);
 assert.ok(short.return>fit.return);
 const tenors=estimateBondTenors(target,{...args,curves:{...curves,
  cdb:{.5:0,1:0,2:0,3:0,5:0,7:.0002,10:.0002},mtn:{.5:0,1:0,2:0,3:0,5:0,7:.0002,10:.0002}}});
 assert.ok(tenors.short.return>tenors.medium.return);
 assert.ok(tenors.medium.return>tenors.long.return);
 assert.equal(tenors.long.tenorLabel,'长端');
 assert.equal(tenors.long.contributions.find(r=>r.name==='超长国债').return,fit.contributions.find(r=>r.name==='超长国债').return);
 assert.equal(estimateBondTenors(target,args).long,null);
 assert.equal(estimateBondCurve(target,{...args,base:{...args.base,provisional:true}}),null);
 assert.equal(estimateBondCurve(target,{...args,curves:{...curves,government:{...government,20:null,30:null}}}),null);
 assert.equal(estimateBondCurve(target,{...args,curves:{government}}),null);
});

test('分期限候选按银行间曲线同次样本前推验证，旧记录和其他披露期不计入',()=>{
 const records={},asOf='2026-09-30',candidates={medium:{method:'bond-curve-v2',return:.0002,disclosedAt:asOf}};
 for(let date=target,i=0;i<17;date=previousNavDate(date),i++){
  const record={};records['007740:'+date]=record;
  const now=new Date(date+'T14:30:00+08:00');
  const sample={date,time:'14:28',now,candidates:i===1?{medium:{...candidates.medium,disclosedAt:'2026-06-30'}}:candidates,legacy:{return:.0006},baseline:{return:i===2?null:.0009}};
  assert.ok(captureBondTenors(record,sample));
  assert.equal(captureBondTenors(record,{...sample,candidates:{medium:{return:1}}}),false);
  assert.equal(record.bondTenors.afternoon.medium.estimate,.0002);
  Object.assign(record,{actual:{date,previousDate:previousNavDate(date),dailyReturn:.0001,adjustment:i===3},firstActualSeenAt:date+'T20:00:00+08:00'});
 }
 assert.equal(selectBondTenor(candidates,records,target,'14:28'),null);
 assert.equal(selectBondTenor(candidates,records,target,'10:28'),null);
 const date=previous;
 const excluded=records['007740:'+date];
 excluded.bondTenors.afternoon.medium.asOf=asOf;
 const selected=selectBondTenor(candidates,records,target,'14:28');
 assert.equal(selected.validation.pairs,15);
 assert.equal(selected.preferred,false);
 assert.equal(preferBondCurve(selected,{afternoon:{preferred:true}}),false);
 records['007740:'+date].firstActualSeenAt=date+'T13:00:00+08:00';
 assert.equal(selectBondTenor(candidates,records,target,'14:28'),null);
});

test('盘中对照只认公布前同次样本，并按基金和时段选择',()=>{
 const records={};
 for(let date=previous,i=0;i<16;date=previousNavDate(date),i++){
  const record={};records['007740:'+date]=record;
  const now=new Date(date+'T14:30:00+08:00');
  assert.ok(captureBondComparison(record,{date,time:'14:28',now}));
  assert.ok(captureBondComparison(record,{date,time:'14:28',now,curve:{return:.0002},baseline:{return:.0009}}));
  assert.equal(captureBondComparison(record,{date,time:'14:29',now,curve:{return:1},baseline:{return:1}}),false);
  Object.assign(record,{actual:{date,previousDate:previousNavDate(date),dailyReturn:.0001,adjustment:i===0},firstActualSeenAt:date+'T20:00:00+08:00'});
  assert.equal(captureBondComparison(record,{date,time:'16:00',now,curve:{return:.0001},baseline:{return:.0001}}),false);
 }
 const stats=bondComparisonStats(records,target);
 assert.equal(stats.afternoon.observed,16);assert.equal(stats.afternoon.pairs,15);
 assert.equal(stats.afternoon.curveDays,16);assert.equal(stats.afternoon.baselineDays,16);
 assert.ok(preferBondCurve({time:'14:30'},stats));assert.ok(!preferBondCurve({time:'10:30'},stats));
});
