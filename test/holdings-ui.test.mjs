import test from 'node:test';
import assert from 'node:assert/strict';
import {holdingSlices,holdingsPie,pageRows} from '../public/holdings-ui.js';
import {contributionPanel} from '../public/forecast-details.js';
import {stockHoldingsReport} from '../lib/holdings-sync.mjs';
test('top ten are ranked by weight and other includes all remaining assets',()=>{
 const rows=Array.from({length:12},(_,i)=>({name:'Stock '+i,code:String(i),weight:i+1}));
 const result=holdingSlices(rows);
 assert.equal(result.slices.length,11);assert.equal(result.slices[0].weight,12);
 assert.equal(result.slices[9].weight,3);assert.equal(result.slices[10].weight,25);
 assert.equal(result.slices.reduce((n,s)=>n+Math.round(s.weight*100),0),10000);
 assert.equal(rows[0].weight,1);
 assert.equal(holdingSlices([{weight:100.01}]).slices[0].weight,100);
 assert.equal(holdingSlices([{weight:110}]).invalid,true);
 assert.equal(holdingSlices([{weight:NaN},{weight:-1}]).slices.length,0);
 assert.match(holdingsPie([{name:'<script>',weight:40}]),/&lt;script&gt;/);
});
test('pagination covers 805 holdings exactly and clamps stale page numbers',()=>{
 const rows=Array.from({length:805},(_,i)=>i);
 assert.deepEqual(Array.from({length:81},(_,i)=>pageRows(rows,i+1).rows).flat(),rows);
 assert.equal(pageRows(rows,99).page,81);assert.equal(pageRows(rows,81).rows.length,5);
 assert.equal(pageRows(rows,-1).page,1);assert.deepEqual(pageRows([],3).rows,[]);
});
test('detail pages sort the entire contribution list before slicing',()=>{
 const rows=Array.from({length:21},(_,i)=>({name:'stock-'+i,code:String(i),weight:i+1,dailyRmbReturn:i/100}));
 const html=contributionPanel(rows,'daily','2026-06-30',2);
 assert.equal((html.match(/<tr>/g)||[]).length,11);
 assert.match(html,/stock-10</);assert.match(html,/stock-1</);
 assert.doesNotMatch(html,/stock-20</);assert.doesNotMatch(html,/stock-0</);
 assert.match(contributionPanel(rows,'daily','2026-06-30',3),/stock-0</);
});
test('sync charts use only snapshots matching the displayed disclosure date',()=>{
 const report={items:[{code:'123456',date:'2026-06-30',status:'unchanged'}]};
 const data={holdingsSnapshots:{'123456':{asOf:'2026-09-30',rows:[{weight:80}]}},lastView:{old:{code:'123456',latestHoldings:{asOf:'2026-06-30',rows:[{name:'old',code:'X',weight:40}]}}}};
 assert.equal(stockHoldingsReport(report,data).items[0].holdings.rows[0].weight,40);
 assert.equal(report.items[0].holdings,undefined);
 data.lastView={};assert.equal(stockHoldingsReport(report,data).items[0].holdings,null);
});
