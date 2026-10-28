import test from 'node:test';
import assert from 'node:assert/strict';
import {syncHoldings,isBondFund,isIndexFund,stockHoldingsReport} from '../lib/holdings-sync.mjs';

test('forced holdings synchronization persists new snapshots and preserves older data on failure',async()=>{
 const row={code:'ABC',name:'股票',weight:5};
 const old={asOf:'2026-06-30',rows:[row]};let saved=0;
 const state={watchlist:['111111','222222','333333','444444','555555','666666'],lastView:{},records:{'111111:2026-10-02':{forecast:{holdingsDate:'2026-06-30'}}},holdingsSnapshots:Object.fromEntries(['222222','333333','444444'].map(c=>[c,old]))};
 const store={data:state,save(){saved++;}},progress=[];
 const report=await syncHoldings(store,p=>progress.push(p),{
  fetchProfile:async code=>({name:code,bond:code==='555555'}),
  fetchHoldings:async(code,options)=>{assert.equal(options.force,true);if(code==='333333')throw Error('网络断开');return {name:code,asOf:code==='444444'?'2023-09-30':code==='222222'?'2026-06-30':'2026-09-30',rows:[row]};},
  fetchBondHoldings:async code=>{assert.equal(code,'555555');return {asOf:'2026-06-30',rows:[{code:'B1',name:'债券1',weight:10}]};}
 });
 assert.deepEqual(report.summary,{updated:3,unchanged:1,failed:2,unsupported:0});
 assert.deepEqual(progress.filter(p=>p.total!==null).map(p=>p.completed),[0,1,2,3,4,5,6]);
 assert.equal(state.holdingsSnapshots['111111'].asOf,'2026-09-30');
 assert.equal(state.bondHoldingsSnapshots['555555'].asOf,'2026-06-30');
 assert.equal(report.items.find(r=>r.code==='555555').bond,true);
 assert.equal(state.holdingsSnapshots['333333'],old);
 assert.equal(state.holdingsSnapshots['444444'],old);
 assert.equal(state.records['111111:2026-10-02'].forecast.holdingsDate,'2026-06-30');
 assert.equal(state.lastHoldingsSync,report);assert.equal(saved,1);
 assert.match(report.items.find(r=>r.code==='444444').message,/更旧/);
});

test('known bonds sync disclosed bond holdings from stored profile, reports keep them visible',async()=>{
 const data={watchlist:['111111'],profiles:{'111111':{profile:{bond:true}}},lastView:{},records:{}};
 assert.equal(isBondFund(data,'111111'),true);
 const fetched=[];
 const report=await syncHoldings({data,save(){}},()=>{},{fetchProfile:()=>{throw Error('must not fetch bond profile');},fetchHoldings:()=>{throw Error('must not fetch stock holdings');},fetchBondHoldings:async code=>{fetched.push(code);return {asOf:'2026-06-30',rows:[{code:'B1',name:'债券1',weight:10}]};}});
 assert.deepEqual(fetched,['111111']);
 assert.equal(report.items.length,1);assert.equal(report.items[0].bond,true);assert.equal(report.items[0].status,'updated');
 assert.equal(data.bondHoldingsSnapshots['111111'].asOf,'2026-06-30');
 const rep={items:[{code:'111111',status:'updated',bond:true,date:'2026-06-30'}],summary:{updated:1}};
 assert.deepEqual(stockHoldingsReport(rep,data).items.map(r=>r.code),['111111']);
});

test('指数和联接基金不请求披露、不计同步进度，主动纳指股票基金仍同步',async()=>{
 const data={watchlist:['040046','000834','111111','222222'],profiles:{'040046':{profile:{name:'华安纳斯达克100ETF联接(QDII)A'}},'000834':{profile:{name:'大成纳斯达克100ETF联接(QDII)A'}}},lastView:{},records:{}};
 assert.equal(isIndexFund(data,'040046'),true);const fetched=[],progress=[];
 const report=await syncHoldings({data,save(){}},p=>progress.push(p),{
  fetchProfile:async code=>{assert.ok(!['040046','000834'].includes(code));return {name:code==='111111'?'某标普500指数基金':'纳斯达克股票精选',bond:false};},
  fetchHoldings:async code=>{fetched.push(code);return {asOf:'2026-06-30',rows:[{code:'TEST',weight:20}]};}
 });
 assert.deepEqual(fetched,['222222']);assert.equal(report.items.length,1);
 assert.ok(progress.filter(p=>p.total!==null).every(p=>p.total===1));
 const old={items:[{code:'040046',status:'unsupported'},{code:'000834',status:'unsupported'},{code:'333333',name:'未映射指数基金',status:'unsupported'},{code:'222222',status:'updated'}]};
 assert.deepEqual(stockHoldingsReport(old,data).items.map(r=>r.code),['222222']);
});

test('incomplete same-period disclosures cannot replace a complete stock snapshot; bond dates cannot regress',async()=>{
 const full={asOf:'2026-06-30',expanded:true,rows:[{code:'A',weight:10},{code:'B',weight:20}]};
 const bond={asOf:'2026-09-30',rows:[{code:'B1',weight:10}]};
 const data={watchlist:['111111','222222'],lastView:{},records:{},holdingsSnapshots:{'111111':full},bondHoldingsSnapshots:{'222222':bond},profiles:{'222222':{profile:{name:'Bond',bond:true}}}};
 const report=await syncHoldings({data,save(){}},()=>{},{fetchProfile:async()=>({name:'Stock',bond:false}),fetchHoldings:async()=>({asOf:full.asOf,rows:[full.rows[0]],expanded:false,expansionError:'timeout'}),fetchBondHoldings:async()=>({asOf:'2026-06-30',rows:bond.rows})});
 assert.equal(data.holdingsSnapshots['111111'].rows.length,2);assert.match(report.items[0].message,/保留/);
 assert.equal(data.bondHoldingsSnapshots['222222'].asOf,'2026-09-30');assert.equal(report.items[1].status,'failed');
});
test('same-date bond weight edits count as an update',async()=>{
 const old={asOf:'2026-09-30',rows:[{code:'B1',weight:10}]};const data={watchlist:['111111'],lastView:{},records:{},profiles:{'111111':{profile:{name:'Bond',bond:true}}},bondHoldingsSnapshots:{'111111':old}};
 const report=await syncHoldings({data,save(){}},()=>{},{fetchBondHoldings:async()=>({...old,rows:[{code:'B1',weight:15}]})});assert.equal(report.summary.updated,1);
});

test('同步前后快照持久保留，报告不被后续同日期数据覆盖',async()=>{
 const before={asOf:'2026-06-30',rows:[{code:'A',secid:'105.A',currency:'USD',name:'甲',weight:10}]};
 const after={asOf:'2026-09-30',rows:[{...before.rows[0],weight:15}]};
 const data={watchlist:['111111'],lastView:{},holdingsSnapshots:{'111111':before}};
 const report=await syncHoldings({data,save(){}},()=>{},{fetchProfile:async()=>({name:'基金'}),fetchHoldings:async()=>after});
 const item=report.items[0];assert.equal(item.previousHoldings.rows[0].weight,10);assert.equal(item.holdings.rows[0].weight,15);assert.ok(item.syncedAt);
 after.rows[0].weight=99;assert.equal(item.holdings.rows[0].weight,15);
 const restored=JSON.parse(JSON.stringify(report));assert.equal(stockHoldingsReport(restored,data).items[0].holdings.rows[0].weight,15);
 const next=await syncHoldings({data,save(){}},()=>{},{fetchProfile:async()=>({name:'基金'}),fetchHoldings:async()=>data.holdingsSnapshots['111111']});
 assert.equal(next.items[0].status,'unchanged');assert.equal(next.items[0].previousHoldings.rows[0].weight,99);
});
