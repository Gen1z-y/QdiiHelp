import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {navPeriodLabel} from '../public/forecast-details.js';
import {ESTIMATION_NOTE} from '../lib/estimation-rules.mjs';
const navReturnValue=vm.runInNewContext(fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').match(/^function navReturnValue[^\n]+/m)[0]+'\nnavReturnValue');

test('涨跌图片仅在所有导出基金实际涨跌齐全时按实际倒序，否则按预估倒序',()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8')
  .split("$('#exportImage').onclick=async()=>{")[1].split(" const exportButton=")[0];
 const fund=(code,forecast,actual)=>({code,name:'全球精选',date:'2026-10-21',navEstimate:{return:forecast},record:{actual:{date:'2026-10-21',dailyReturn:actual,previousDate:'2026-10-20'}}});
 const sorted=items=>{
  const original=items.map(f=>f.code);
  const result=vm.runInNewContext(`(()=>{${source}\nreturn exportItems.map(f=>f.code);})()`,{busy:false,items,navReturnValue});
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
 const period={...fund('555555',-.9,null),record:{actual:{date:'2026-10-21',returnFrom:'2026-10-20',intervalReturn:.08}}};
 assert.deepEqual(sorted([fund('111111',.03,-.02),fund('222222',.02,0),period]),['555555','222222','111111']);
 const stale={...fund('333333',.05,.99),record:{actual:{date:'2026-10-20',dailyReturn:.99}},latestNav:{date:'2026-10-20',dailyReturn:.99}};
 assert.deepEqual(sorted([fund('111111',.03,-.02),fund('222222',.02,0),stale]),['333333','111111','222222']);
});

test('导出指数与基金使用同一单日或累计区间，排除指数基金与债基',async()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split("$('#exportImage').onclick=async()=>{")[1];
 for(const [cumulative,failed] of [[false,false],[true,false],[false,true]]){
  const text=[],rectangles=[],button={},notices=[],dialogs=[];
  const context={scale(){},save(){},restore(){},translate(){},rotate(){},fillRect(...args){rectangles.push(args);},fillText(...args){text.push([...args,this.font,this.fillStyle]);},measureText(s){return {width:s.length*18};}};
  const element=()=>({dataset:{},children:[],append(...children){this.children.push(...children);},setAttribute(){},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;}});
  const fund=(code,name,extra={})=>({code,name,date:'2026-10-02',record:{forecast:{base:{date:'2026-09-29'},model:{dailyReturn:.01,return:.03}}},cumulativeWindow:{show:cumulative},...(cumulative?{navEstimate:{to:'2026-10-08',from:'2026-09-30',asOf:'2026-10-02',partial:true,mode:'cumulative',return:.03}}:{}),...extra});
  const sandbox={navPeriodLabel,ESTIMATION_NOTE,navReturnValue,busy:false,items:[fund('123456','保留基金'),fund('019305','排除基金'),fund('040046','指数基金',{index:true}),fund('000001','债券基金',{bond:true})],activeDate:'auto',
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

test('导出公布涨跌只展示对应净值日期，旧公布留空且不逐行显示日期',async()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split("$('#exportImage').onclick=async()=>{")[1];
 const text=[],button={},notices=[];
 const context={scale(){},save(){},restore(){},translate(){},rotate(){},fillRect(){},fillText(...args){text.push([...args,this.font,this.fillStyle]);},measureText(s){return {width:s.length*18};}};
 const element=()=>({dataset:{},children:[],append(...v){this.children.push(...v);},setAttribute(){},addEventListener(){},showModal(){},close(){},remove(){}});
 const fund=(code,actual,latestNav)=>({code,name:'验证基金',date:'2026-10-20',navEstimate:{return:null},record:{actual},latestNav});
 const items=[fund('018147',{date:'2026-10-20',dailyReturn:null,intervalReturn:.010552,returnFrom:'2026-10-16',returnTo:'2026-10-20',returnPeriod:'fund-valuation'}),
  fund('016701',{date:'2026-10-20',dailyReturn:null,intervalReturn:.009588,returnFrom:'2026-10-16',returnTo:'2026-10-20'}),
  fund('270023',{date:'2026-10-20',dailyReturn:-.0108,intervalReturn:.99}),
  fund('111111',null,{date:'2026-10-20',dailyReturn:0}),fund('222222',null,null),
  {...fund('006555',null,{date:'2026-10-20',dailyReturn:-.0058}),date:'2026-10-21',navEstimate:{return:.0243}},
  {...fund('333333',{date:'2026-10-20',dailyReturn:.99},{date:'2026-10-20',dailyReturn:.99}),date:'2026-10-21'},
  fund('444444',{date:'2026-10-19',dailyReturn:.88},{date:'2026-10-20',dailyReturn:.002}),
  {...fund('555555',{date:'2026-10-20',dailyReturn:.77},{date:'2026-10-21',dailyReturn:.003}),navEstimate:{to:'2026-10-21',return:.02}}];
 const sandbox={navPeriodLabel,ESTIMATION_NOTE,navReturnValue,busy:false,items,activeDate:'auto',$:()=>button,notice:s=>notices.push(s),
  pct:v=>Number.isFinite(v)?(v*100).toFixed(2)+'%':'—',
  api:async(url,options)=>url==='/api/export-data'?{today:'2026-10-21',holiday:null}:{items:JSON.parse(options.body).windows.map(w=>({...w,indices:[]}))},
  document:{fonts:{ready:Promise.resolve()},body:element(),createElement:tag=>tag==='canvas'?{getContext:()=>context,toDataURL:()=> 'data:image/png;base64,test'}:element()}};
 vm.runInNewContext("$('#exportImage').onclick=async()=>{"+source,sandbox);await button.onclick();
 assert.deepEqual(notices,[]);assert.equal(button.disabled,false);
 const labels=text.map(t=>t[0]);assert.ok(labels.includes('公布涨跌'));
 for(const [code,value,color] of [['018147','1.06%','#bc324b'],['016701','0.96%','#bc324b'],
  ['270023','-1.08%','#278363'],['111111','0.00%','#62748c'],['444444','0.20%','#bc324b'],['555555','0.30%','#bc324b']]){
  const y=text.find(t=>t[0]===code)[2],cell=text.find(t=>t[1]===1250&&t[2]===y);
  assert.equal(cell[0],value);assert.equal(cell[4],color);

 }
 const missingY=text.find(t=>t[0]==='222222')[2];assert.ok(text.some(t=>t[0]==='—'&&t[1]===1250&&t[2]===missingY));
 for(const code of ['006555','333333']){
  const y=text.find(t=>t[0]===code)[2];assert.ok(text.some(t=>t[0]==='—'&&t[1]===1250&&t[2]===y),'旧公布不能填入目标日 '+code);
 }
 const forecastY=text.find(t=>t[0]==='006555')[2];assert.ok(text.some(t=>t[0]==='2.43%'&&t[1]===950&&t[2]===forecastY),'21日预估继续保留');
 const tableY=text.find(t=>t[0]==='基金代码')[2];
 assert.ok(!text.some(t=>t[2]>=tableY&&/净值日期|2026-10-|→|区间|本期/.test(t[0])));
 assert.ok(!labels.includes('净值日期 2026-10-21'));
});
