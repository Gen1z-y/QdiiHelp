import test from 'node:test';
import assert from 'node:assert/strict';
import {fundNavPeriod,supplementFundNavReturn} from '../lib/fund-nav-calendar.mjs';
import {mergePublishedNav} from '../lib/nav-publication.mjs';
import {navs} from '../lib/provider.mjs';
import {forecastStats} from '../lib/forecast-stats.mjs';

const rows=[{date:'2026-10-20',value:2.107,cumulativeNav:2.107,dailyReturn:null},
 {date:'2026-10-16',value:2.085,cumulativeNav:2.085,dailyReturn:-.0266}];
test('已核实基金假期与真实缺失开放日分开，不能按持仓泛化到其他基金',()=>{
 for(const code of ['018147','539002'])assert.equal(fundNavPeriod(code,'2026-10-16','2026-10-20').returnReason,'重阳节');
 for(const [code,from,to] of [['016701','2026-10-16','2026-10-20'],['018147','2026-10-15','2026-10-20'],
  ['018147','2027-10-15','2027-10-20'],['018147','2026-10-19','2026-10-20'],
  ['018147','2026-10-16','2026-10-19'],['018147','2026-10-20','2026-10-21'],['018147','bad','2026-10-20']])
  assert.equal(fundNavPeriod(code,from,to),null);
});
test('相邻公布净值可补本期涨跌，保留假期来源与起止日且不填单日收益',()=>{
 const result=supplementFundNavReturn('018147',rows)[0];
 assert.ok(Math.abs(result.intervalReturn-.01055155875)<1e-10);
 assert.equal(result.dailyReturn,null);assert.equal(result.returnSource,'公布净值计算');
 assert.equal(result.returnFrom,'2026-10-16');assert.equal(result.returnTo,'2026-10-20');
 assert.equal(result.returnPeriod,'fund-valuation');assert.match(result.returnCalendarSource,/AN202512301811063793/);
 assert.equal(rows[0].intervalReturn,undefined);
 const stats=forecastStats('018147',{'018147:2026-10-20':{actual:result,forecast:{date:result.date,base:{date:'2026-10-19'},model:{return:.01,method:'test'}}}});
 assert.equal(stats.pairedCount,0);
});
test('分红、折算、缺累计净值、真实数据缺口及备用源矛盾均不能推导',()=>{
 for(const patch of [{distribution:'分红'},{adjustment:true},{cumulativeNav:null},{cumulativeNav:2.2},{value:0},{intervalReturn:.1}]){
  const changed=[{...rows[0],...patch},rows[1]];
  assert.equal(supplementFundNavReturn('018147',changed),changed);
 }
 for(const changed of [rows.slice(0,1),[rows[0],{...rows[1],date:'2026-10-15'}],
  [{...rows[0],dailyReturn:0},rows[1]]])assert.equal(supplementFundNavReturn('018147',changed),changed);
 assert.equal(supplementFundNavReturn('016701',rows),rows);
 const zero=[{...rows[0],value:2.085,cumulativeNav:2.085},rows[1]];
 assert.equal(supplementFundNavReturn('018147',zero)[0].intervalReturn,0);
});
test('同日短暂回退保留本期说明，主源补齐或净值修订时不残留旧说明',()=>{
 const previous=supplementFundNavReturn('018147',rows)[0];
 assert.equal(mergePublishedNav(previous,rows[0]).returnPeriod,'fund-valuation');
 const main={...rows[0],dailyReturn:.0106};
 assert.deepEqual(mergePublishedNav(previous,main),main);
 assert.equal(mergePublishedNav(previous,{...rows[0],value:2.108}).intervalReturn,undefined);
});
test('真实获取链路中备用源缺失仍补本期值，备用源可用时保留交叉核对来源',async()=>{
 const real=globalThis.fetch;let tencent=true;
 globalThis.fetch=async input=>{
  if(String(input).includes('lsjz'))return {ok:true,text:async()=>JSON.stringify({Data:{LSJZList:rows.map(r=>({FSRQ:r.date,DWJZ:String(r.value),LJJZ:String(r.cumulativeNav),JZZZL:r.dailyReturn===null?'':String(r.dailyReturn*100)}))}})};
  if(!tencent)throw Error('备用源不可用');
  return {ok:true,text:async()=>'v_jj018147="018147~测试基金~0~0~~2.1070~2.1070~1.0552~2026-10-20~";'};
 };
 try{
  const cross=(await navs('018147',true))[0];
  assert.equal(cross.returnPeriod,'fund-valuation');assert.equal(cross.returnSource,'腾讯基金');
  tencent=false;const computed=(await navs('018147',true))[0];
  assert.equal(computed.returnSource,'公布净值计算');assert.equal(computed.dailyReturn,null);
  assert.equal(computed.returnPeriod,'fund-valuation');
 }finally{globalThis.fetch=real;}
});
