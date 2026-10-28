import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastStats} from '../lib/forecast-stats.mjs';
import {forecastChart,detailHistoryChart,publishedChartPairs} from '../public/forecast-chart.js';
import fs from 'node:fs';
import vm from 'node:vm';
import {observationPanel} from '../public/forecast-details.js';

test('historical official NAV fills chart gaps without inventing forecasts or accuracy samples',()=>{
 const records={'123456:2026-10-02':{forecast:{base:{date:'2026-09-29'},model:{dailyReturn:.0076,return:.0276}}}};
 const original=JSON.stringify(records);
 const historyRows=[{date:'2026-09-28',value:1.8,dailyReturn:-.01},{date:'2026-09-29',value:1.9,dailyReturn:.02},{date:'2026-09-30',value:1.9,dailyReturn:0},{date:'2026-10-03',value:2,dailyReturn:.04},{date:'2026-06-01',value:1,dailyReturn:.03},{date:'2026-09-25',value:1,dailyReturn:null}];
 const stats=forecastStats('123456',records,{historyRows,targetDate:'2026-10-02'});
 assert.deepEqual(stats.pairs.map(r=>r.date),['2026-10-02','2026-09-30','2026-09-29','2026-09-28']);
 assert.equal(stats.pairs[1].actual,0);assert.equal(stats.pairs[1].forecast,null);
 assert.equal(stats.pairs[0].forecast,.0276);assert.equal(stats.pairedCount,0);
 assert.equal(JSON.stringify(records),original);
 const chart=forecastChart(stats.pairs);assert.match(chart,/净值日期 2026-10-02/);assert.match(chart,/计算基准净值日 2026-09-29/);assert.match(chart,/官方历史净值/);
});
test('historical correction updates displayed actual but preserves its stored evidence',()=>{
 const records={'123456:2026-09-29':{actual:{dailyReturn:.01},firstActualSeenAt:'2026-10-01T00:00:00Z'}};
 const stats=forecastStats('123456',records,{historyRows:[{date:'2026-09-29',value:1,dailyReturn:.012}],targetDate:'2026-10-02'});
 assert.equal(stats.pairs[0].actual,.012);assert.equal(records['123456:2026-09-29'].actual.dailyReturn,.01);
 assert.equal(records['123456:2026-09-29'].firstActualSeenAt,'2026-10-01T00:00:00Z');
});

test('long charts fit the viewport while retaining every date for inspection and preserving gaps',()=>{
 const pairs=Array.from({length:2000},(_,i)=>({date:new Date(Date.UTC(2020,0,1)+i*86400000).toISOString().slice(0,10),actual:i===1000?null:i/100000,forecast:null}));
 const chart=forecastChart(pairs);const inspected=JSON.parse(chart.match(/data-chart-values="([^"]+)"/)[1].replace(/&quot;/g,'"'));
 assert.equal(inspected.length,2000);assert.equal(inspected[1000].actual,null);assert.equal(inspected.at(-1).date,pairs.at(-1).date);assert.match(chart,/width="100%"/);assert.doesNotMatch(chart,/width="9220"/);
 assert.ok((chart.match(/class="pointValue"/g)||[]).length<20);assert.match(chart,/max="1999"/);assert.match(chart,/>2020-01-01<\/text>/);assert.match(chart,new RegExp('>'+pairs.at(-1).date+'<\\/text>'));
});

test('详情图在公布净值日期补上已有结果，保留预估和原始统计',()=>{
 const actual={date:'2026-10-20',value:2.107,dailyReturn:null,intervalReturn:.010552,returnSource:'腾讯基金'};
 const records={'018147:2026-10-20':{forecast:{date:actual.date,base:{date:'2026-10-19'},model:{return:-.0063,method:'test'}},actual}};
 const original=JSON.stringify(records),stats=forecastStats('018147',records,{targetDate:actual.date}),snapshot=JSON.stringify(stats);
 const pairs=[{date:'2026-10-16',actual:-.0266,forecast:-.0302},...stats.pairs];
 const chart=detailHistoryChart(pairs,90,'periodic',[],[actual]);
 const inspected=JSON.parse(chart.match(/data-chart-values="([^"]+)"/)[1].replace(/&quot;/g,'"'));
 const last=inspected.at(-1);assert.equal(last.date,'2026-10-20');assert.equal(last.actual,.010552);assert.equal(last.forecast,-.0063);
 assert.match(chart,/2026-10-20 公布涨跌 1.06%/);assert.match(chart,/腾讯基金/);
 assert.equal(stats.pairedCount,0);assert.equal(JSON.stringify(stats),snapshot);assert.equal(JSON.stringify(records),original);
 assert.equal(pairs.at(-1).actual,.010552);
});

test('最近公布结果可独立加入图表，0有效；完整历史优先，缺失不补0',()=>{
 const pairs=[{date:'2026-10-16',actual:-.0266},{date:'2026-10-19',forecast:.01,actual:null}];
 const published=[{date:'2026-10-20',value:2,dailyReturn:null,intervalReturn:.01},
  {date:'2026-10-20',value:2,dailyReturn:0},null,{date:'2026-10-21',value:2,dailyReturn:null},
  {date:'bad',value:2,dailyReturn:.99},{date:'2026-10-22',value:Infinity,dailyReturn:.99}];
 const original=JSON.stringify({pairs,published});
 const rows=publishedChartPairs(pairs,published);assert.equal(rows.at(-1).date,'2026-10-20');assert.equal(rows.at(-1).actual,0);
 assert.equal(rows[1].actual,null);assert.equal(rows.at(-1).forecast,null);assert.equal(JSON.stringify({pairs,published}),original);
 assert.equal(publishedChartPairs([{date:'2026-10-20',actual:.02}],published)[0].actual,.02);
});

test('真实详情入口传递当前及最近公布结果，但不带入目标日期之后的数据',()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 let passed;const actual={date:'2026-10-20',value:2,intervalReturn:.01};
 const ctx={observationPanel,detailHistories:new Map(),detailDays:90,detailChartMode:'periodic',fund:{code:'018147',date:'2026-10-20',record:{actual},latestNav:{date:'2026-10-21',value:2,dailyReturn:.99}},
  detailHistoryChart:(...args)=>{passed=args;return '';}};
 vm.runInNewContext(source.slice(source.indexOf('function detailHistoryPanel('),source.indexOf('function renderDetail(')),ctx);
 vm.runInNewContext('detailHistoryPanel(fund)',ctx);assert.equal(passed[4].length,1);assert.equal(passed[4][0],actual);
});
