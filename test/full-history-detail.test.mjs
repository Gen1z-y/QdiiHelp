import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fetchHistory} from '../lib/history.mjs';
import {quoteStatusBadge,contributionPanel,contributionRows} from '../public/forecast-details.js';
import {detailHistoryChart} from '../public/forecast-chart.js';
test('fresh legacy truncated cache is upgraded beyond 30 pages and 410 days',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-full-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'data','history');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'000001.json'),JSON.stringify({schema:2,fetchedAt:new Date().toISOString(),rows:[{date:'2026-10-13',value:1}]}));
 const rows=Array.from({length:900},(_,i)=>({FSRQ:new Date(Date.UTC(2026,9,13)-i*86400000).toISOString().slice(0,10),DWJZ:'1',JZZZL:'0'}));let calls=0;
 const h=await fetchHistory('000001',root,{fetcher:async url=>{calls++;const page=+new URL(url).searchParams.get('pageIndex');return {ok:true,json:async()=>({TotalCount:900,Data:{LSJZList:rows.slice((page-1)*20,page*20)}})};}});
 assert.equal(calls,45);assert.equal(h.rows.length,900);assert.equal(h.historyComplete,true);assert.equal(h.rows.at(-1).date,rows.at(-1).FSRQ);
});
test('premature empty page cannot mark history complete',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-empty-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 await assert.rejects(fetchHistory('000001',root,{fetcher:async()=>({ok:true,json:async()=>({TotalCount:100,Data:{LSJZList:[]}})})}),/提前/);
});
test('unknown calendar does not hide valid Korean quote; filters precede pagination',()=>{
 const kr={name:'SK海力士',weight:20,rmbReturn:.02,stock:{return:.02,base:{date:'2026-10-12'},target:{date:'2026-10-13'}},marketStatus:{state:'complete',known:false}};
 assert.match(quoteStatusBadge(kr),/>行情可用</);assert.doesNotMatch(quoteStatusBadge(kr),/>休市安排待确认</);
 const missing={name:'缺行情',weight:40,marketStatus:{state:'complete',known:false}};
 assert.equal(contributionRows([kr,missing],'cumulative')[0].name,'缺行情');
 const html=contributionPanel([missing,kr],'cumulative','2026-06-30',1,'complete');assert.match(html,/SK海力士/);assert.doesNotMatch(html,/>缺行情</);assert.match(html,/class="up"/);
 assert.match(contributionPanel([kr],'cumulative',null,1,'error'),/没有持仓/);
});
test('detail history can switch from recent month to inception without fake forecasts',()=>{
 const pairs=[{date:'2010-01-01',actual:0},{date:'2026-10-13',actual:.01}];
 assert.doesNotMatch(detailHistoryChart(pairs,30),/2010-01-01/);assert.match(detailHistoryChart(pairs,0),/2010-01-01/);assert.match(detailHistoryChart(pairs,0),/data-detail-days="1825"/);
});
