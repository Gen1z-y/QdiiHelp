import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import * as details from '../public/forecast-details.js';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function screen(f){
 const nodes=new Map(),get=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',open:false});return nodes.get(s);};
 const ctx=vm.createContext({...details,$:get,detailHistories:new Map(),detailDays:90,detailChartMode:'periodic',contributionMode:'cumulative',contributionPage:1,quoteFilter:'all',items:[f,{code:'222222',name:'Other',record:{},latestHoldings:{rows:[]}}],comparing:new Set([f.code,'222222']),
  esc:s=>String(s??''),num:(v,d=4)=>Number.isFinite(v)?v.toFixed(d):'—',pct:v=>Number.isFinite(v)?(v*100).toFixed(2)+'%':'—',color:()=>'',calibrationBadge:()=>'',calibrationTile:()=>'',valuationFxTile:()=>'',fxReferenceNote:()=>'',detailTabs:sections=>sections.map(s=>s.html).join(''),detailHistoryPanel:()=>'',accuracyContent:()=>'',selected:null});
 vm.runInContext(source.slice(source.indexOf('function bondReferenceState('),source.indexOf("let detailTab='overview';")),ctx);
 vm.runInContext(source.slice(source.indexOf('function renderIndexDetail('),source.indexOf("$('#exportImage').onclick=")),ctx);
 vm.runInContext(source.slice(source.indexOf('function renderDetail('),source.indexOf('async function refresh(')),ctx);
 vm.runInContext(source.slice(source.indexOf('function renderComparison('),source.indexOf("$('#detail').addEventListener('click'")),ctx);
 ctx.f=f;vm.runInContext('renderDetail(f);renderComparison()',ctx);return {detail:get('#detail').innerHTML,comparison:get('#comparison').innerHTML};
}
const fixture=()=>({code:'111111',name:'Saved',date:'2026-10-19',base:{date:'2026-10-16',value:9},latestHoldings:{asOf:'2026-09-30',rows:[]},
 navEstimate:{from:'2026-10-16',to:'2026-10-19',return:.01,value:1.0504},record:{forecast:{date:'2026-10-19',base:{date:'2026-10-16',value:1.04},holdingsDate:'2026-06-30',model:{return:.01,coverage:79.53},rows:[]}}});
test('stock and index summaries hide estimated NAV and keep saved index quotes',()=>{
 const f=fixture();assert.doesNotMatch(screen(f).detail,/预估净值|1\.0504|基准 2026-10-16 · 1\.0400/);
 const q={name:'Saved index',date:f.date,dailyReturn:.02,close:102,previousClose:100};f.indexQuote={...q,name:'New quote',dailyReturn:.5};f.record.forecast.indexQuote=q;
 const html=screen(f).detail;assert.match(html,/Saved index/);assert.doesNotMatch(html,/New quote/);assert.doesNotMatch(html,/预估净值|1\.0504|基准 2026-10-16 · 1\.0400/);
});
test('comparison covers partial estimates and labels the holdings used for that estimate',()=>{
 const f=fixture();f.record.partialForecast=f.record.forecast;delete f.record.forecast;
 assert.match(screen(f).comparison,/79\.53%/);assert.match(screen(f).comparison,/估算所用持仓日期/);assert.match(screen(f).comparison,/2026-06-30/);
});
test('diagnostic-only inputs do not supply FX impact when no valid estimate is displayed',()=>{
 const f={navEstimate:{return:null},analysis:{date:'2026-10-19',base:{date:'2026-10-16'},model:{return:.01},rows:[{weight:50,currency:'USD',rmbReturn:.01,stock:{return:0},fx:{return:.01}}]}};
 assert.equal(details.fundFxImpact(f),null);
});
