import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {holdingsChanged} from '../lib/holdings-version.mjs';
import {canReuseView} from '../lib/load-policy.mjs';
import {loadState} from '../lib/storage-format.mjs';

test('same-date same-count weight edits invalidate views while row order does not',()=>{
 const a={asOf:'2026-06-30',rows:[{code:'A',secid:'105.A',weight:10},{code:'B',weight:20}]};
 const reordered={...a,rows:[...a.rows].reverse()};assert.equal(holdingsChanged(a,reordered),false);
 const changed={...a,rows:[{...a.rows[0],weight:15},a.rows[1]]};assert.equal(holdingsChanged(a,changed),true);
 const view={checkedAt:new Date().toISOString(),latestHoldings:a};assert.equal(canReuseView(view,changed),false);assert.equal(canReuseView(view,reordered),true);
});
test('sync refreshes all funds, updates home snapshot, preserves published forecasts and restores backups',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-workflow-'));process.env.PORT='8796';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 const seedRow={code:'TEST',name:'测试股票',secid:'105.TEST',weight:20};
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:['111111','222222'],records:{},lastView:{},holdingsSnapshots:{'111111':{asOf:'2026-06-30',rows:[seedRow],fetchedAt:'2026-10-01T00:00:00Z'},'222222':{asOf:'2026-06-30',rows:[seedRow],fetchedAt:'2026-10-01T00:00:00Z'}}}));
 const realFetch=globalThis.fetch;let weight=20,close=110,actualValue=1.03,published=false,broken=false,server,stall=null,entered=null;
 globalThis.fetch=async(input,options)=>{
  const url=String(input);if(url.startsWith('http://127.0.0.1:'))return realFetch(input,options);
  if(url.includes('pingzhongdata'))return {ok:true,text:async()=> 'var fS_name = "测试全球股票基金A";'};
  if(url.includes('FundArchivesDatas')){
   if(broken)throw Error('模拟持仓接口失败');
   const html=`<a title='测试全球股票基金A'>基金</a>截止至：<font>2026-06-30</font><tbody><tr><td>1</td><td><a href='//quote.eastmoney.com/unify/r/105.TEST'>TEST</a></td><td>测试股票</td><td>${weight}%</td></tr></tbody>`;
   return {ok:true,text:async()=> 'var apidata={content:'+JSON.stringify(html)+'};'};
  }
  if(url.includes('lsjz')&&stall){entered?.();await stall;}
  let value;
  if(url.includes('lsjz'))value={TotalCount:2,Data:{LSJZList:[...(published&&url.includes('222222')?[{FSRQ:'2026-10-02',DWJZ:String(actualValue),JZZZL:String((actualValue-1)*100)}]:[]),{FSRQ:'2026-10-01',DWJZ:'1',JZZZL:'0'},{FSRQ:'2026-09-30',DWJZ:'1',JZZZL:'0'}]}};
  else if(url.includes('push2his'))value={data:{klines:(url.includes('120.')?[['2026-09-30',7],['2026-10-01',7],['2026-10-02',7]]:[['2026-09-30',100],['2026-10-01',100],['2026-10-02',close]]).map(([d,c])=>`${d},1,${c},1,1,1,1,1,0`)}};
  else throw Error('Unexpected upstream '+url);
  return {ok:true,text:async()=>JSON.stringify(value),json:async()=>value};
 };
 const get=async(route,body)=>{const r=await realFetch('http://127.0.0.1:8796'+route,body?{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}:{});const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));return j;};
 try{
  ({server}=await import('../server.mjs'));if(!server.listening)await new Promise(r=>server.once('listening',r));
  const initial=await get('/api/funds?date=2026-10-02');assert.ok(Math.abs(initial.items[0].record.forecast.model.dailyReturn-.02)<1e-10);
  const frozen=initial.items.find(f=>f.code==='222222').record.forecast;
  weight=40;published=true;
  const response=await realFetch('http://127.0.0.1:8796/api/holdings/sync',{method:'POST',body:JSON.stringify({date:'2026-10-02',stream:true})});
  const events=(await response.text()).trim().split('\n').map(JSON.parse),report=events.at(-1).data;
  assert.equal(events.at(-1).type,'result',JSON.stringify(events.at(-1)));
  assert.ok(events.some(e=>e.phase==='recalculate'));assert.equal(report.summary.updated,2);assert.equal(report.items[0].previousHoldings.rows[0].weight,20);assert.equal(report.items[0].holdings.rows[0].weight,40);assert.deepEqual(report.recalculation,{updated:1,published:1,unavailable:0});
  const home=await get('/api/funds?date=2026-10-02&cached=1');
  assert.ok(Math.abs(home.items.find(f=>f.code==='111111').record.forecast.model.dailyReturn-.04)<1e-10);
  assert.deepEqual(home.items.find(f=>f.code==='222222').record.forecast,frozen);
  assert.ok(Math.abs(home.items.find(f=>f.code==='222222').record.actual.dailyReturn-.03)<1e-10);
  const savedPublished=home.items.find(f=>f.code==='222222').record;
  close=120;actualValue=1.09;
  const unchanged=await get('/api/holdings/sync',{date:'2026-10-02'});assert.equal(unchanged.summary.unchanged,2);assert.equal(unchanged.recalculation.updated,1);
  assert.equal(unchanged.refreshSummary.total,2);
  assert.ok(Math.abs(unchanged.data.items.find(f=>f.code==='111111').record.forecast.model.dailyReturn-.08)<1e-10,'unchanged holdings still use fresh quotes');
  assert.deepEqual(unchanged.data.items.find(f=>f.code==='222222').record,savedPublished,'published history stays unchanged');
  broken=true;const failed=await get('/api/holdings/sync',{date:'2026-10-02'});assert.equal(failed.summary.failed,2);assert.equal(failed.data.items[0].latestHoldings.rows[0].weight,40);broken=false;
  const before=loadState(process.env.QDII_DATA_FILE),backup=await get('/api/backups',{});
  weight=50;await get('/api/holdings/sync',{date:'2026-10-02'});
  const invalid=await realFetch('http://127.0.0.1:8796/api/backups/restore',{method:'POST',body:JSON.stringify({id:backup.id})});assert.equal(invalid.status,400);
  let release;stall=new Promise(r=>{release=r;});const reached=new Promise(r=>{entered=r;});
  const running=get('/api/recalculate',{date:'2026-10-02'});await reached;
  const restore=get('/api/backups/restore',{id:backup.id,confirmed:true});
  try{
   let blocked=false;for(let i=0;i<20;i++){
    const probe=await realFetch('http://127.0.0.1:8796/api/health');await probe.text();
    if(probe.status===503){blocked=true;break;}await new Promise(r=>setTimeout(r,10));
   }
   assert.equal(blocked,true,'new requests are blocked while the old computation drains');
  }finally{stall=null;release();}
  await running;const restored=await restore;assert.ok(restored.safetyBackup);
  assert.deepEqual(loadState(process.env.QDII_DATA_FILE).records,before.records);
  assert.equal((await get('/api/funds?date=2026-10-02&cached=1')).items[0].latestHoldings.rows[0].weight,40);
  weight=60;
  const one=await get('/api/holdings/sync-one',{code:'111111'});
  assert.equal(one.sync.status,'updated');assert.equal(one.sync.date,'2026-06-30');
  assert.equal(one.item.latestHoldings.rows[0].weight,60);
  assert.equal(loadState(process.env.QDII_DATA_FILE).holdingsSnapshots['111111'].rows[0].weight,60);
  assert.equal(one.sync.holdings.rows[0].weight,60);assert.equal(one.sync.previousHoldings.rows[0].weight,40);assert.ok(one.sync.syncedAt);
  assert.equal((await get('/api/holdings/sync')).items.find(r=>r.code==='111111').status,'updated');
  broken=true;
  const streamed=await realFetch('http://127.0.0.1:8796/api/holdings/sync-one',{method:'POST',body:JSON.stringify({code:'111111',stream:true})});
  assert.match(streamed.headers.get('content-type'),/ndjson/);
  const stages=(await streamed.text()).trim().split('\n').map(JSON.parse);
  assert.ok(stages.some(e=>e.type==='progress'&&/基金资料/.test(e.stage)));
  assert.ok(stages.some(e=>e.type==='progress'&&/披露/.test(e.stage)));
  assert.ok(stages.some(e=>e.type==='progress'&&/估算/.test(e.stage)));
  assert.equal(stages.at(-1).type,'result');assert.equal(stages.at(-1).data.sync.status,'failed');
  assert.equal(stages.at(-1).data.sync.holdings.rows[0].weight,60);assert.equal(stages.at(-1).data.sync.previousHoldings.rows[0].weight,60);
  broken=false;
  const notInList=await realFetch('http://127.0.0.1:8796/api/holdings/sync-one',{method:'POST',body:JSON.stringify({code:'999999'})});
  assert.equal(notInList.status,400);
 }finally{globalThis.fetch=realFetch;if(server)await new Promise(r=>server.close(r));}
});
