import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBondDisclosure,disclosureAt,mergeBondHolding,bondDisclosures} from '../lib/bond-disclosure.mjs';
import {ADAPTIVE_BOND_FACTORS,parseBondWealth,bondWealthBars} from '../lib/bond-factors.mjs';
import {adaptiveBondReference,adaptiveFitReturn} from '../lib/bond-adaptive.mjs';
import {bondFitForecast} from '../lib/bond-forecast.mjs';
import {forecastIssue} from '../lib/forecast-policy.mjs';
import {replayForecast} from '../lib/replay-audit.mjs';
import {session,shiftDate,expectedCloseDate} from '../lib/calendar.mjs';

const content='5.1 报告期末基金资产组合情况 1 权益投资 - - 5.2 报告期末 股票投资组合 本基金未持有股票 5.4 报告期末按债券品种分类的债券投资组合 1 国家债券 100 20.00 2 金融债券 300 60.00 其中：政策性金融债 100 20.00 3 企业债券 10 2.00 4 企业短期融资券 10 2.00 5 中期票据 100 20.00 6 可转债（可交换债） - - 7 同业存单 10 2.00 8 其他 - - 10 合计 530 106.00 5.5 报告期末按公允价值排序';
const disclosure=()=>parseBondDisclosure(content,{asOf:'2025-12-31',publishedAt:'2026-01-20',url:'https://example.com/report'});
test('季度券种配置保留净值分母和超过100%的敞口，政策债不重复计数',()=>{
 const d=disclosure();assert.equal(d.categories.total,106);assert.equal(d.categories.policy,20);assert.equal(d.categories.financial,60);assert.equal(d.stockWeight,0);
 assert.throws(()=>parseBondDisclosure(content.replace('106.00','100.00'),d),/配置合计异常/);
 assert.throws(()=>parseBondDisclosure(content.replace('国家债券','未知类型'),d),/缺少券种/);
 assert.equal(disclosureAt([d],'2026-01-20'),null);assert.equal(disclosureAt([d],'2026-01-21'),d);assert.equal(disclosureAt([d],'2027-01-01'),null);
 assert.equal(mergeBondHolding({disclosures:[d]},{asOf:d.asOf,rows:[],disclosures:[],disclosureError:'断网'}).disclosures[0],d);
});
test('报告查询选择季度报告，不将同日截止的中期报告误用为季度模板',async()=>{
 const fetcher=async url=>String(url).includes('JJGG')?{ok:true,text:async()=>JSON.stringify({ErrCode:0,Data:[
  {FUNDCODE:'888887',ID:'AN1',TITLE:'测试2026年第2季度报告',PUBLISHDATE:'2026-07-21'},
  {FUNDCODE:'888887',ID:'AN2',TITLE:'测试2026年中期报告',PUBLISHDATE:'2026-08-31'}]})}:
  {ok:true,json:async()=>({success:1,data:{notice_content:content}})};
 const rows=await bondDisclosures('888887','2026-06-30',{fetcher});assert.equal(rows.length,1);assert.equal(rows[0].publishedAt,'2026-07-21');assert.match(rows[0].url,/AN1/);
});
test('财富指数解析使用北京时间并拒绝坏值，缺少目标日不补造',async()=>{
 const json={CFZS_00:{[Date.parse('2026-10-27T00:00:00+08:00')]:100,[Date.parse('2026-10-28T00:00:00+08:00')]:100.1}};
 const bars=parseBondWealth(json);assert.equal(bars[1].date,'2026-10-28');assert.equal(bars[1].previousDate,'2026-10-27');assert.ok(Math.abs(bars[1].dayReturn-.001)<1e-12);
 assert.throws(()=>parseBondWealth({CFZS_00:{'1':null}}),/无效/);assert.throws(()=>parseBondWealth({QJZS_00:{}}),/格式/);
 let calls=0;const fetcher=async()=>{calls++;return {ok:true,json:async()=>json};};
 const [a,b]=await Promise.all([bondWealthBars('cb:short','2026-10-29',{fetcher}),bondWealthBars('cb:short','2026-10-29',{fetcher})]);
 assert.equal(calls,1);assert.equal(a.at(-1).date,'2026-10-28');assert.deepEqual(a,b);
});

function fixture(){
 const dates=[];for(let d='2026-01-05';dates.length<125;d=shiftDate(d,1))if(!session(d,'CN').closed)dates.push(d);
 const series=Object.fromEntries(ADAPTIVE_BOND_FACTORS.map((f,j)=>[f.symbol,dates.map((date,i)=>({date,previousDate:dates[i-1],dayReturn:.00015+Math.sin(i*(j+1)*.37)*.0006+Math.cos(i*(j+2)*.23)*.0002}))]));
 const rows=dates.map((date,i)=>({date,value:1+i*.0001,dailyReturn:.00002+series['cb:short'][i].dayReturn*.4+series['cb:ultra'][i].dayReturn*.6}));
 const target=dates.at(-1),history={rows},d={...disclosure(),asOf:'2026-03-31',publishedAt:'2026-04-21'},baseline={return:.1,coeffs:[0,0,0,0],factors:[],samples:100,r2:.9};
 return {target,history,holdings:{disclosures:[d]},baseline,quote:async(s,t)=>series[s].filter(b=>b.date<=t),legacy:async t=>({return:rows.find(r=>r.date===t).dailyReturn+.0002}),d};
}
test('持仓约束候选按逐日验证选择，封存可以独立回放并识别输入篡改',async()=>{
 const fx=fixture(),ref=await adaptiveBondReference(fx.target,fx);assert.equal(ref.method,'bond-fit-v2');assert.equal(ref.validation.count,30);assert.ok(ref.validation.to<fx.target);assert.ok(ref.coeffs.slice(1).every(c=>c>=0));
 const base={date:expectedCloseDate(shiftDate(fx.target,-1),'CN'),value:1};
 const now=new Date(fx.target+'T17:00:00+08:00');
 const {candidate}=await bondFitForecast(fx.target,{base,reference:async()=>ref,now});
 assert.ok(candidate);assert.equal(forecastIssue(candidate),null);assert.equal(replayForecast(candidate).return,candidate.model.return);
 const bad=structuredClone(candidate);bad.fit.factors[0].date='2026-01-01';assert.match(forecastIssue(bad),/预估无效/);
 const post=structuredClone(candidate);post.fit.disclosure.publishedAt=fx.target;assert.match(forecastIssue(post),/验证不完整/);
 const wrong=structuredClone(candidate);wrong.model.return+=.01;assert.match(forecastIssue(wrong),/预估无效/);
 const validation=structuredClone(candidate);validation.fit.validation.candidateMae=1;assert.match(forecastIssue(validation),/验证不完整/);
 assert.equal(adaptiveFitReturn({...ref,factors:ref.factors.slice(1)},fx.target),null);
});
test('未来净值不会进入训练；未公布持仓、缺指数、差候选和不足验证样本均回退',async()=>{
 const fx=fixture(),a=await adaptiveBondReference(fx.target,fx);
 const b=await adaptiveBondReference(fx.target,{...fx,history:{rows:[...fx.history.rows.filter(r=>r.date<fx.target),{date:fx.target,dailyReturn:100},{date:'2027-01-01',dailyReturn:100}]}});
 assert.deepEqual(b.coeffs,a.coeffs);assert.equal(b.return,a.return);
 const late=await adaptiveBondReference(fx.target,{...fx,holdings:{disclosures:[{...fx.d,publishedAt:fx.target}]}});assert.equal(late.return,.1);assert.match(late.adaptive.reason,/缺少/);
 const stock=await adaptiveBondReference(fx.target,{...fx,holdings:{disclosures:[{...fx.d,stockWeight:1}]}});assert.match(stock.adaptive.reason,/股票或转债/);
 const stale=await adaptiveBondReference(fx.target,{...fx,quote:async(s,t)=>(await fx.quote(s,t)).filter(b=>b.date<t)});assert.equal(stale.adaptive.status,'pending');
 const waiting=await bondFitForecast(fx.target,{base:{date:expectedCloseDate(shiftDate(fx.target,-1),'CN'),value:1},now:new Date(fx.target+'T17:00:00+08:00'),reference:async()=>stale});assert.equal(waiting.candidate,null);assert.match(waiting.unavailable,/等待中债/);
 const offline=await adaptiveBondReference(fx.target,{...fx,quote:async()=>{throw Error('断网');}});assert.match(offline.adaptive.reason,/获取失败/);
 const short=await adaptiveBondReference(fx.target,{...fx,history:{rows:fx.history.rows.slice(-65)}});assert.match(short.adaptive.reason,/验证样本不足/);
 const perfect=await adaptiveBondReference(fx.target,{...fx,legacy:async t=>({return:fx.history.rows.find(r=>r.date===t).dailyReturn})});assert.match(perfect.adaptive.reason,/候选未/);
});
