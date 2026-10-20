import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {navPeriodLabel} from '../public/forecast-details.js';
import {ESTIMATION_NOTE} from '../lib/estimation-rules.mjs';

test('涨跌图片仅在所有导出基金实际涨跌齐全时按实际倒序，否则按预估倒序',()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8')
  .split("$('#exportImage').onclick=async()=>{")[1].split(" const exportButton=")[0];
 const fund=(code,forecast,actual)=>({code,name:'全球精选',navEstimate:{return:forecast},record:{actual:{dailyReturn:actual}}});
 const sorted=items=>{
  const original=items.map(f=>f.code);
  const result=vm.runInNewContext(`(()=>{${source}\nreturn exportItems.map(f=>f.code);})()`,{busy:false,items});
  assert.deepEqual(items.map(f=>f.code),original,'导出不改变页面基金顺序');
  return Array.from(result);
 };
 const excluded=[{...fund('000001',.9,undefined),bond:true},{...fund('000002',.9,undefined),index:true},fund('019305',.9,undefined)];
 assert.deepEqual(sorted([fund('111111',.03,-.02),fund('222222',.02,0),fund('333333',.01,.04),...excluded]),['333333','222222','111111']);
 for(const missing of [undefined,null,NaN,Infinity]){
  assert.deepEqual(sorted([fund('333333',-.01,missing),fund('222222',.02,.04),fund('111111',.03,-.02),...excluded]),['111111','222222','333333']);
 }
 assert.deepEqual(sorted([fund('333333',null,.08),fund('222222',-.02,undefined),fund('111111',0,undefined),fund('444444',undefined,undefined)]),['111111','222222','333333','444444']);
 assert.deepEqual(sorted([fund('111111',undefined,-.02),fund('222222',undefined,-.01)]),['222222','111111']);
});

test('导出指数与基金使用同一单日或累计区间，排除指数基金与债基',async()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split("$('#exportImage').onclick=async()=>{")[1];
 for(const [cumulative,failed] of [[false,false],[true,false],[false,true]]){
  const text=[],rectangles=[],button={},notices=[],dialogs=[];
  const context={scale(){},save(){},restore(){},translate(){},rotate(){},fillRect(...args){rectangles.push(args);},fillText(...args){text.push(args);},measureText(s){return {width:s.length*18};}};
  const element=()=>({dataset:{},children:[],append(...children){this.children.push(...children);},setAttribute(){},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;}});
  const fund=(code,name,extra={})=>({code,name,date:'2026-10-02',record:{forecast:{base:{date:'2026-09-29'},model:{dailyReturn:.01,return:.03}}},cumulativeWindow:{show:cumulative},...(cumulative?{navEstimate:{to:'2026-10-08',from:'2026-09-30',asOf:'2026-10-02',partial:true,mode:'cumulative',return:.03}}:{}),...extra});
  const sandbox={navPeriodLabel,ESTIMATION_NOTE,busy:false,items:[fund('123456','保留基金'),fund('019305','排除基金'),fund('040046','指数基金',{index:true}),fund('000001','债券基金',{bond:true})],activeDate:'auto',
   $:()=>button,notice:v=>notices.push(v),pct:v=>Number.isFinite(v)?(v*100).toFixed(2)+'%':'—',
   api:async(url,options)=>{if(url==='/api/export-data')return {today:'2026-10-08',holiday:null};const {body}=options;assert.equal(dialogs[0].open,true);assert.equal(dialogs[0].children[1].textContent,'正在获取导出图片的指数行情…');if(failed)throw new Error('行情暂不可用');assert.equal(url,'/api/export-indices');const {windows,currency}=JSON.parse(body);assert.equal(currency,'CNY');assert.equal(windows.length,1);if(cumulative){assert.equal(windows[0].date,'2026-10-02');assert.equal(windows[0].from,'2026-09-30');}return {items:windows.map(w=>({...w,indices:[['IXIC','纳斯达克综合'],['NDX','纳斯达克100'],['SPX','标普500']].map(([id,name])=>({id,name,value:.02}))}))};},
   document:{fonts:{ready:Promise.resolve()},body:element(),createElement:tag=>{if(tag==='canvas')return {getContext:()=>context,toDataURL:()=> 'data:image/png;base64,test'};const el=element();if(tag==='dialog')dialogs.push(el);return el;}}};
  vm.runInNewContext("$('#exportImage').onclick=async()=>{"+source,sandbox);await button.onclick();
  assert.equal(button.disabled,false);assert.equal(notices.length,0);
  if(failed){assert.equal(dialogs[0].open,true);assert.equal(dialogs[0].children[0].textContent,'图片导出失败');assert.equal(dialogs[0].children[1].textContent,'行情暂不可用');assert.equal(dialogs[0].children[2].hidden,true);continue;}
  assert.equal(dialogs[0].open,false);assert.equal(dialogs[0].removed,true);assert.equal(dialogs[1].open,true);
  const labels=text.map(r=>r[0]);
  assert.ok(labels.includes('123456'));for(const code of ['019305','040046','000001'])assert.ok(!labels.includes(code));
  const tableY=text.find(r=>r[0]==='基金代码')[2];
  for(const name of ['纳斯达克综合','纳斯达克100','标普500'])assert.ok(text.find(r=>r[0]===name)[2]<tableY);
  assert.equal(labels.filter(s=>s.startsWith('累计预估')).length,0);
  const period=text.find(r=>r[0]===(cumulative?'10月1日至8日合计预估':'10月2日预估'));
  assert.ok(period);assert.ok(period[1]<750&&period[2]<tableY);
  for(const name of ['纳斯达克综合','纳斯达克100','标普500'])assert.ok(text.find(r=>r[0]===name)[1]>330);
  assert.ok(labels.includes('美')&&labels.includes('人')&&labels.some(s=>s.startsWith('美元/人民币')));
  assert.ok(!text.some(r=>r[2]>=tableY&&/10月|10-08|10-02|2026-/.test(r[0])));
  if(cumulative)assert.ok(labels.some(s=>s.includes('已计入到 2026-10-02 的行情，尚未算完')));
  assert.ok(labels.includes('净值观察台 · QDII HELP'));
 }
});
