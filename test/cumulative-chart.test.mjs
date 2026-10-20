import test from 'node:test';import assert from 'node:assert/strict';
import {cumulativeChartRows,detailHistoryChart} from '../public/forecast-chart.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
test('cumulative compounds gains and losses and excludes baseline day return',()=>{
 const pairs=[{date:'2026-10-01',actual:.99},{date:'2026-10-02',actual:.1},{date:'2026-10-03',actual:-.1}];const original=JSON.stringify(pairs);const c=cumulativeChartRows(pairs);
 assert.equal(c.base,'2026-10-01');assert.equal(c.rows[0].actual,0);close(c.rows[2].actual,-.01);assert.equal(JSON.stringify(pairs),original);
});
test('overlapping holiday forecasts anchor to published base rather than compound one another',()=>{
 const c=cumulativeChartRows([{date:'2026-09-29',actual:0},{date:'2026-09-30',actual:.1},{date:'2026-10-01',baseDate:'2026-09-30',forecast:.02},{date:'2026-10-02',baseDate:'2026-09-30',forecast:.03}]);
 close(c.rows[2].forecast,.122);close(c.rows[3].forecast,.133);assert.equal(c.rows[3].actual,null);
});
test('missing, earlier and future forecast bases are left blank; zero is preserved',()=>{
 const c=cumulativeChartRows([{date:'2026-10-01',actual:0},{date:'2026-10-02',forecast:.02},{date:'2026-10-03',baseDate:'2026-09-30',forecast:.01},{date:'2026-10-04',baseDate:'2026-10-05',forecast:.01},{date:'2026-10-05',baseDate:'2026-10-01',forecast:0,actual:0}]);
 assert.ok(c.rows.slice(1,4).every(r=>r.forecast===null));assert.equal(c.rows[4].forecast,0);assert.equal(c.rows[4].actual,0);
});
test('missing official NAV return stops cumulative values rather than assuming zero',()=>{
 const c=cumulativeChartRows([{date:'2026-10-01',actual:0},{date:'2026-10-02',actual:null,officialNav:true},{date:'2026-10-03',actual:.1}]);assert.equal(c.incomplete,true);assert.equal(c.rows[2].actual,null);
 const html=detailHistoryChart([{date:'2026-10-01',actual:0},{date:'2026-10-03',actual:.1}],0,'cumulative',[{date:'2026-10-01',value:1,dailyReturn:0},{date:'2026-10-02',value:1,dailyReturn:null},{date:'2026-10-03',value:1.1,dailyReturn:.1}]);assert.match(html,/缺口后停止/);assert.doesNotMatch(html,/10.00%/);
});
test('selected range resets baseline and shows cumulative mode controls and summary',()=>{
 const pairs=[{date:'2026-01-01',actual:0},{date:'2026-09-01',actual:.1},{date:'2026-10-01',actual:.1}];
 assert.match(detailHistoryChart(pairs,30,'cumulative'),/基准净值日 <strong>2026-09-01/);assert.match(detailHistoryChart(pairs,0,'cumulative'),/21.00%/);assert.match(detailHistoryChart(pairs,0,'cumulative'),/data-history-mode="cumulative" aria-pressed="true"/);assert.match(detailHistoryChart(pairs,0,'periodic'),/单日涨跌/);
});
test('forecast-only history never fabricates cumulative performance',()=>{
 const c=cumulativeChartRows([{date:'2026-10-02',baseDate:'2026-10-01',forecast:.01}]);assert.equal(c.base,null);assert.deepEqual(c.rows,[]);assert.match(detailHistoryChart([{date:'2026-10-02',forecast:.01}],0,'cumulative'),/无法计算累计涨跌/);
});

test('precise NAV avoids compounded daily rounding errors and handles reinvested cash dividends',()=>{
 const r=cumulativeChartRows([{date:'2026-10-01',actual:0,value:2,cumulativeNav:2},{date:'2026-10-02',actual:.0499,value:1.8,cumulativeNav:2.1}]);close(r.rows[1].actual,.05);assert.equal(r.approximateCount,0);
 const split=cumulativeChartRows([{date:'2026-10-01',actual:0,value:2,cumulativeNav:2},{date:'2026-10-02',actual:.01,value:1,cumulativeNav:1,adjustment:true}]);close(split.rows[1].actual,.01);assert.equal(split.approximateCount,1);
});

import fs from 'node:fs';import vm from 'node:vm';
test('live detail click handler switches metrics and preserves selected range',()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');const begin=source.indexOf("$('#detail').addEventListener('click',e=>{");const end=source.indexOf('\nfunction calibrationInfo',begin);let handler,drawn;
 const context={detailChartMode:'periodic',detailDays:90,selected:'007740',items:[{code:'007740'}],$:()=>({addEventListener:(type,fn)=>{handler=fn;}}),renderDetail:f=>{drawn=f;}};
 vm.runInNewContext(source.slice(begin,end),context);
 handler({target:{closest:selector=>selector==='[data-history-mode]'?{dataset:{historyMode:'cumulative'}}:null}});assert.equal(context.detailChartMode,'cumulative');assert.equal(drawn.code,'007740');assert.equal(context.detailDays,90);
 handler({target:{closest:selector=>selector==='[data-detail-days]'?{dataset:{detailDays:'365'}}:null}});assert.equal(context.detailDays,365);assert.equal(context.detailChartMode,'cumulative');
 handler({target:{closest:selector=>selector==='[data-history-mode]'?{dataset:{historyMode:'periodic'}}:null}});assert.equal(context.detailChartMode,'periodic');
});
