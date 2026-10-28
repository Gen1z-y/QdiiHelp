import test from 'node:test';
import assert from 'node:assert/strict';
import {holdingSlices,holdingsBars,pageRows,holdingChanges,holdingsComparison,holdingsReadState,holdingsResultRow,holdingsAnnouncementLinks,holdingsDateSummary,holdingsUpdatedFunds} from '../public/holdings-ui.js';
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
 assert.match(holdingsBars([{name:'<script>',weight:40}]),/&lt;script&gt;/);
 const chart=holdingsBars([{name:'股票',weight:40}]);assert.match(chart,/rect x="0" y="0" width="40" height="2"/);assert.match(chart,/rect x="40" y="0" width="60" height="2"/);assert.doesNotMatch(chart,/<circle|<path|<ul|<li |holdingsPie/);
 assert.match(chart,/<span class="holdingsInlineName">股票<\/span>/);assert.match(chart,/<strong>40.00%<\/strong>/);assert.match(chart,/data-holdings-scroll="1"/);
 const segments=[...holdingsBars(rows).matchAll(/<rect x="([\d.]+)" y="0" width="([\d.]+)"/g)];
 assert.equal(segments.length,11);assert.equal(Number(segments.at(-1)[1])+Number(segments.at(-1)[2]),100);
});
test('持仓截至日区分无变化、同一期修订与换期，相同日期只显示一次',()=>{
 const row={code:'123456',name:'基金',status:'unchanged',date:'2026-06-30',previousDate:'2026-06-30',count:0};
 const cell=holdingsResultRow(row,{}).split('</td>')[1];
 assert.equal((cell.match(/2026-06-30/g)||[]).length,1);assert.match(cell,/本次无变化/);assert.doesNotMatch(cell,/→/);
 assert.equal(holdingsDateSummary(row),'持仓截至 2026-06-30 · 本次无变化');
 assert.match(holdingsDateSummary({...row,status:'updated'}),/同一期持仓已更新/);
 assert.match(holdingsDateSummary({...row,date:'2026-09-30',status:'updated'}),/持仓截至 2026-09-30 · 上期截至 2026-06-30/);
 assert.match(holdingsDateSummary({...row,previousDate:null}),/首次同步/);
 assert.match(holdingsDateSummary({...row,status:'failed',date:null}),/2026-06-30 · 同步失败，保留原持仓/);
 const links=holdingsAnnouncementLinks({periods:[]},row);assert.equal((links.match(/2026-06-30/g)||[]).length,1);
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

test('新旧披露按标的匹配，区分新增、缺席、占比变化、零与未知',()=>{
 const before={rows:[{code:'A',name:'甲',weight:10},{code:'B',weight:5},{code:'C',weight:0},{code:'D',weight:2},{code:'E',weight:3}]};
 const after={rows:[{code:'E',weight:3},{code:'C',weight:2},{code:'A',name:'甲改名',weight:8},{code:'F',weight:4},{code:'D',weight:null}]};
 const changes=holdingChanges(before,after),by=Object.fromEntries(changes.map(r=>[r.code,r]));
 assert.equal(changes.length,5);assert.equal(by.A.delta,-2);assert.equal(by.A.name,'甲改名');
 assert.equal(by.B.kind,'removed');assert.equal(by.B.newWeight,null);
 assert.equal(by.F.kind,'added');assert.equal(by.F.oldWeight,null);
 assert.equal(by.C.delta,2);assert.equal(by.C.oldWeight,0);assert.equal(by.D.kind,'unknown');
 assert.deepEqual(before.rows.map(r=>r.weight),[10,5,0,2,3]);
 const reordered={...before,rows:[...before.rows].reverse()};assert.deepEqual(holdingChanges(before,reordered),[]);
 const markets={rows:[{code:'123',secid:'105.123',weight:1},{code:'123',secid:'116.123',weight:2}]};
 assert.equal(holdingChanges(markets,{rows:[{...markets.rows[0],weight:3},markets.rows[1]]}).length,1);
});
test('对比覆盖全部明细，旧报告无基线时不捏造买卖',()=>{
 const before={asOf:'2026-06-30',rows:Array.from({length:805},(_,i)=>({code:String(i),name:'<股票>',weight:.01}))};
 const after={asOf:'2026-09-30',rows:before.rows.map(r=>({...r,weight:.02}))};
 assert.equal(holdingChanges(before,after).length,805);
 const row={code:'111111',name:'<基金>',status:'updated',previousDate:before.asOf,date:after.asOf,count:805,previousHoldings:before,holdings:after};
 const html=holdingsResultRow(row,{},true),dialog=holdingsComparison(row,true);
 assert.match(html,/持仓变化 · 805 项/);assert.match(html,/data-holdings-changes="111111"/);assert.match(html,/aria-haspopup="dialog"/);assert.match(html,/公告原文/);
 assert.doesNotMatch(html,/holdingsChangeTable|details class="holdingsChanges"/);
 assert.match(dialog,/0.01%/);assert.match(dialog,/0.02%/);assert.match(dialog,/\+0.01</);assert.equal((dialog.match(/<tr>/g)||[]).length,806);
 assert.match(dialog,/&lt;股票&gt;/);assert.doesNotMatch(dialog,/<股票>/);assert.match(html,/holdingsDot/);
 assert.match(holdingsComparison({...row,previousHoldings:null}),/未保存旧明细/);
 assert.match(holdingsComparison({...row,previousHoldings:null,previousDate:null}),/首次同步/);
 assert.equal(holdingsComparison({...row,status:'failed'}),'');
 assert.match(holdingsComparison({...row,holdings:{...after,rows:before.rows}}),/持仓截至日更新，占比未变/);
});
test('公告入口在无变化与首次同步时仍可用，链接标题和日期安全转义',()=>{
 const row={code:'123456',name:'测试',status:'unchanged',date:'2026-09-30',count:0};
 assert.match(holdingsResultRow(row,{}),/公告原文/);
 const html=holdingsAnnouncementLinks({periods:[{asOf:'2026-09-30',reports:[{title:'<报告>',url:'https://fund.eastmoney.com/gonggao/123456,AN123.html',publishedAt:'2026-10-27'}]}]},row);
 assert.match(html,/&lt;报告&gt;/);assert.match(html,/target="_blank" rel="noopener noreferrer"/);assert.match(html,/公告日期 2026-10-27/);assert.doesNotMatch(html,/原披露期/);
 assert.match(holdingsAnnouncementLinks({periods:[]},row),/未匹配到该披露期/);
});
test('持仓更新红点记住已读，同日修订重新提醒，无变化与失败不亮点',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};
 const read=holdingsReadState(storage),report={serverTime:'run1'},row={code:'111111',status:'updated',syncedAt:'one1'};
 assert.equal(read.unseen(row,report),true);read.mark(row,report);assert.equal(read.unseen(row,report),false);
 assert.equal(holdingsReadState(storage).unseen(row,{serverTime:'other-fund-run'}),false);
 assert.equal(read.unseen({...row,syncedAt:'one2'},report),true);
 for(const status of ['unchanged','failed','unsupported'])assert.equal(read.unseen({...row,status},report),false);
 const broken=holdingsReadState({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}});
 broken.mark(row,report);assert.equal(broken.unseen(row,report),false);
 assert.equal(holdingsReadState({getItem:()=> 'null'}).unseen(row,report),true);
});
test('更新名单只列成功更新的基金，可定位并切换筛选，名称安全转义',()=>{
 const rows=[{code:'111111',name:'<更新甲>',date:'2026-09-30',status:'updated'},{code:'222222',name:'更新乙',date:'2026-06-30',status:'updated'},...['unchanged','failed','unsupported'].map((status,i)=>({code:String(333333+i),name:'未更新'+i,status}))];
 const html=holdingsUpdatedFunds(rows);
 assert.match(html,/本次更新 2 只/);assert.match(html,/data-holdings-jump="111111"/);assert.match(html,/&lt;更新甲&gt;/);assert.match(html,/更新乙/);assert.match(html,/持仓截至 2026-09-30/);assert.doesNotMatch(html,/未更新|<更新甲>/);
 assert.match(html,/aria-pressed="false">只看更新/);assert.match(holdingsUpdatedFunds(rows,true),/aria-pressed="true">查看全部基金/);
 assert.equal(holdingsUpdatedFunds(rows.slice(2)),'');assert.equal(holdingsUpdatedFunds([]),'');
});
