import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {estimateLabel,intervalNote} from '../public/forecast-details.js';
import {bondReference,usableBondReference,BOND_FACTORS} from '../lib/bond-reference.mjs';
const target='2026-10-22';
const at=t=>new Date(target+'T'+t+':00+08:00');
const ref=(date=target)=>({return:-.0003,indexDate:date,carried:false,factors:BOND_FACTORS.map(f=>({...f,date,carried:false,dayReturn:0}))});

test('开盘前、未来、休市及未知日历不使用参考，也不请求指数',async()=>{
 for(const [date,now,reason] of [[target,at('09:29'),/未开盘/],['2026-10-23',at('10:00'),/尚未到/],['2026-10-01',at('10:00'),/国内休市/],['2025-10-22',at('10:00'),/日历待确认/]]){
  const result=await bondReference(date,{now,quote:()=>{throw Error('不应请求指数');}});
  assert.equal(result.return,null);assert.match(result.unavailable,reason);
  assert.equal(usableBondReference(date,ref(date),now).return,null);
 }
 assert.equal(usableBondReference(target,ref(),at('09:30')).return,-.0003);
});
test('缓存参考必须三个因子均为目标日有效行情，零涨跌有效',()=>{
 for(const value of [ref('2026-10-21'),{...ref(),carried:true},{...ref(),factors:ref().factors.slice(1)},{...ref(),factors:ref().factors.map((f,i)=>i?f:{...f,carried:true})}]){
  assert.equal(usableBondReference(target,value,at('10:00')).return,null);
 }
 assert.equal(usableBondReference(target,{...ref(),return:0},at('10:00')).return,0);
});

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function screen(reference,clock){
 const RealDate=Date,Clock=class extends RealDate {constructor(...args){super(...(args.length?args:[clock]));}static now(){return RealDate.parse(clock);}};
 const nodes=new Map(),get=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',open:false});return nodes.get(s);};
 const f={bond:true,code:'007542',name:'测试债券基金A',date:target,record:{},navEstimate:{return:null},bondReference:reference,latestNav:{date:'2026-10-21',value:1.1,dailyReturn:0}};
 const ctx=vm.createContext({estimateLabel,intervalNote,Date:Clock,$:get,Intl,f,sortMode:'manual',busy:false,holdingsBusy:false,reliability:()=>({}),unseen:()=>false,
  esc:s=>String(s??''),num:v=>Number.isFinite(v)?v.toFixed(4):'—',pct:v=>Number.isFinite(v)?(v*100).toFixed(2)+'%':'—',color:()=>'',fundTypeClass:()=>'',
  observationPanel:()=>'',forecastInputs:()=>null,detailHistories:new Map(),calibrationBadge:()=>'',calibrationTile:()=>'',detailTabs:sections=>sections.map(s=>s.html).join(''),detailHistoryPanel:()=>'',accuracyContent:()=>'',bondFitPanel:()=>'',navPeriodLabel:()=>''});
 vm.runInContext(source.slice(source.indexOf('function bondReferenceState('),source.indexOf("let detailTab='overview';")),ctx);
 ctx.unseen=()=>false;
 vm.runInContext(source.slice(source.indexOf('function cardState('),source.indexOf('let cardTimer=')),ctx);
 vm.runInContext(source.slice(source.indexOf('function renderDetail('),source.indexOf('async function refresh(')),ctx);
 const card=vm.runInContext("fundCard(f,0,[f],'bond')",ctx);vm.runInContext('renderDetail(f)',ctx);
 return {card,detail:get('#detail').innerHTML};
}
test('卡片和详情在开盘前挡住旧后台缓存数字，开盘后才展示当天参考',()=>{
 const before=screen(ref(),target+'T09:29:00+08:00');
 for(const html of Object.values(before)){assert.match(html,/国内市场未开盘/);assert.doesNotMatch(html,/-0\.03%|盘中参考|1\.0997/);}
 const stale=screen(ref('2026-10-21'),target+'T10:00:00+08:00');
 for(const html of Object.values(stale)){assert.doesNotMatch(html,/-0\.03%|盘中参考/);assert.match(html,/等待.*指数行情/);}
 for(const html of Object.values(screen(ref(),target+'T10:00:00+08:00'))){assert.match(html,/-0\.03%/);assert.match(html,/盘中参考/);}
 for(const html of Object.values(screen(ref(),target+'T15:01:00+08:00'))){assert.match(html,/指数拟合参考/);assert.doesNotMatch(html,/盘中参考/);}
});
