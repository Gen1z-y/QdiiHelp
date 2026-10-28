import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as details from '../public/forecast-details.js';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const fixture=()=>({code:'111111',name:'模拟基金',date:'2026-10-21',navEstimate:{from:'2026-10-20',to:'2026-10-21',return:.0133,value:1.0133},latestNav:{date:'2026-10-20',value:1,dailyReturn:-.0108},
 record:{forecast:{date:'2026-10-21',base:{date:'2026-10-20',value:1},model:{return:.0133,coverage:87.09,method:'market-close-v4'},rows:[]}},
 stats:{groups:[{method:'market-close-v4',windows:[{count:10,bias:-.27,mae:.30}]}]}});
function screen(){
 const nodes=new Map(),get=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',open:false,addEventListener:(type,fn)=>{get(s).handler=fn;},querySelectorAll:()=>[]});return nodes.get(s);};
 const ctx=vm.createContext({...details,$:get,detailHistories:new Map(),detailDays:90,detailChartMode:'periodic',contributionMode:'cumulative',contributionPage:1,quoteFilter:'all',
  sortMode:'manual',busy:false,holdingsBusy:false,selected:null,reliability:()=>({}),unseen:()=>false,fundTypeClass:()=>'',
  esc:s=>String(s??''),num:(v,d=4)=>Number.isFinite(v)?v.toFixed(d):'—',pct:v=>Number.isFinite(v)?(v>0?'+':'')+(v*100).toFixed(2)+'%':'—',color:()=>'',
  detailHistoryPanel:()=>'<p>图表内容</p>',bondFitPanel:()=>'<p>拟合内容</p>',accuracyContent:()=>'<p>准确性内容</p>'});
 for(const [start,end] of [
  ['function bondReferenceState(',"let detailTab='overview';"],
  ["let detailTab='overview';",'function cardState('],
  ['function cardState(','let cardTimer='],
  ['function calibrationInfo(','let syncOneBusy='],
  ['function valuationFxTile(',"$('#exportImage').onclick="],
  ['function renderDetail(','async function refresh('],
  ["$('#detail').addEventListener('click',e=>{",'function calibrationInfo(']
 ])vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),ctx);
 ctx.unseen=()=>false;
 return {ctx,node:get('#detail'),show:f=>{ctx.f=f;vm.runInContext('renderDetail(f)',ctx);return get('#detail').innerHTML;},card:f=>{ctx.f=f;return vm.runInContext("fundCard(f,0,[f],'watch')",ctx);}};
}
test('股票、指数和债基详情默认概览，指标仅在概览内，保留校准角标并移除独立校准卡片',()=>{
 for(const type of ['stock','index','bond']){
  const f=fixture(),s=screen();f.pendingPublications=[{date:f.date,from:'2026-10-20',asOf:f.date,return:.0133}];f.marketProgress=[{name:'美国',weight:70,state:'complete'}];if(type==='index')f.indexQuote={name:'模拟指数',date:f.date,dailyReturn:.02};if(type==='bond')f.bond=true;
  const html=s.show(f),overview=html.match(/<section class="detailTabPanel" data-dtabpanel="overview" >([\s\S]*?)<\/section>/)?.[1];
  const overviewTab=html.slice(html.indexOf('data-dtabpanel="overview"'),html.indexOf('data-dtabpanel="chart"'));assert.match(overviewTab,/估值区间与公布进度/);assert.match(overviewTab,/待公布净值/);assert.match(overviewTab,/美国/);assert.ok(overview);assert.match(overview,/detailsummary/);assert.match(overview,/校准 \+1\.60%/);assert.match(html,/data-dtab="overview" aria-selected="true"/);
  assert.match(html,/data-dtabpanel="chart" hidden/);assert.doesNotMatch(html,/<small>校准参考<\/small>|预估净值/);
  assert.equal((html.match(/class="detailsummary"/g)||[]).length,1);assert.doesNotMatch(html.replace(overview,''),/class="detailsummary"/);
 }
});
test('详情标签切换隐藏概览，重新渲染保留所选标签',()=>{
 const s=screen(),f=fixture();s.show(f);
 const tabs=['overview','chart','contrib','accuracy'].map(id=>({dataset:{dtab:id},setAttribute(name,value){this[name]=value;}}));
 const panels=tabs.map(t=>({dataset:{dtabpanel:t.dataset.dtab},hidden:t.dataset.dtab!=='overview'}));
 s.node.querySelectorAll=selector=>selector==='[data-dtab]'?tabs:panels;
 for(const id of ['chart','contrib','accuracy','overview']){
  const tab=tabs.find(t=>t.dataset.dtab===id);s.node.handler({target:{closest:selector=>selector==='[data-dtab]'?tab:null}});
  assert.equal(panels.find(p=>p.dataset.dtabpanel===id).hidden,false);assert.ok(panels.filter(p=>p.dataset.dtabpanel!==id).every(p=>p.hidden));
  assert.match(s.show(f),new RegExp('data-dtab="'+id+'" aria-selected="true"'));
 }
});
test('首页和详情采用相同校准值，历史统计更新后共同调整，原预估保留',()=>{
 const s=screen(),f=fixture(),original=structuredClone(f);
 assert.match(s.card(f),/校准 \+1\.60%/);assert.match(s.show(f),/校准 \+1\.60%/);
 s.ctx.detailHistories.set(f.code,{stats:{groups:[{method:'market-close-v4',windows:[{count:11,bias:.20,mae:.25}]}]}});
 assert.match(s.card(f),/校准 \+1\.13%/);assert.match(s.show(f),/校准 \+1\.13%/);assert.match(s.card(f),/\+1\.33%/);assert.deepEqual(f,original);
});
test('无有效预估、少于10次或模型不符时不展示校准，零值有效',()=>{
 const s=screen();
 for(const change of [f=>{f.navEstimate.return=null;},f=>{f.stats.groups[0].windows[0].count=9;},f=>{f.stats.groups[0].method='other';}]){
  const f=fixture();change(f);assert.doesNotMatch(s.card(f),/class="calTag"/);assert.doesNotMatch(s.show(f),/class="calTag"/);
 }
 const f=fixture();f.navEstimate.return=0;f.stats.groups[0].windows[0].bias=0;assert.match(s.card(f),/校准 0\.00%/);
});