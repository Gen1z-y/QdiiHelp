import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastStats} from '../lib/forecast-stats.mjs';
import {forecastChart} from '../public/forecast-chart.js';

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
