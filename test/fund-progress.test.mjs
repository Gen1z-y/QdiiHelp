import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('fund stream reports actual completions before final data and supports recalculation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-progress-'));
 process.env.PORT='8793';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:['123456','234567'],records:{},lastView:{}}));
 const realFetch=globalThis.fetch;
 globalThis.fetch=async input=>{
  const url=String(input);
  if(url.startsWith('http://127.0.0.1:'))return realFetch(input);
  await new Promise(resolve=>setTimeout(resolve,35));
  if(url.includes('pingzhongdata'))return {ok:true,text:async()=> 'var fS_name = "进度验证债券基金";'};
  if(url.includes('type=zqcc')){const html="<a title='进度验证债券基金'>基金</a>截止至：<font class='px12'>2026-06-30</font><tbody><tr><td>1</td><td>260205</td><td>26国开05</td><td>15.74%</td><td>1</td></tr></tbody>";return {ok:true,text:async()=> 'var apidata={content:'+JSON.stringify(html)+'};'};}
  if(url.includes('lsjz')){const j={TotalCount:2,Data:{LSJZList:[{FSRQ:'2026-10-02',DWJZ:'1.04',JZZZL:'4'},{FSRQ:'2026-09-30',DWJZ:'1',JZZZL:'0'}]}};return {ok:true,text:async()=>JSON.stringify(j),json:async()=>j};}
  throw Error('测试未配置的上游请求');
 };
 let server;
 try{
  ({server}=await import('../server.mjs'));
  if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  for(const force of [false,true]){
   const response=await realFetch(force?'http://127.0.0.1:8793/api/recalculate':'http://127.0.0.1:8793/api/funds?date=2026-10-02&stream=1',force?{method:'POST',body:JSON.stringify({date:'2026-10-02',stream:true})}:{});
   assert.match(response.headers.get('content-type'),/ndjson/);
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',events=[];
   const first=await reader.read();const initial=decoder.decode(first.value);assert.match(initial,/"type":"progress"/);assert.doesNotMatch(initial,/"type":"result"/);buffer+=initial;
   while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});}
   events=buffer.trim().split('\n').map(JSON.parse);
   assert.deepEqual(events.filter(e=>e.type==='progress'&&e.total===2&&!e.stage).map(e=>e.completed),[0,1,2]);
   assert.ok(events.some(e=>e.stage?.includes('净值')));
   assert.equal(events.at(-1).type,'result');assert.equal(events.at(-1).data.items.length,2);
   assert.equal(events.at(-1).data.historySync,true);
   if(!force)assert.ok(events.at(-1).data.items.every(f=>f.history.count===0),'current results arrive without waiting for history');
   while((await(await realFetch('http://127.0.0.1:8793/api/history-sync')).json()).running)await new Promise(r=>setTimeout(r,20));
   const cached=await(await realFetch('http://127.0.0.1:8793/api/funds?date=2026-10-02&cached=1')).json();
   for(const f of cached.items){assert.equal(f.history.count,2);assert.equal(f.stats.pairs.find(r=>r.date==='2026-09-30').actual,0);assert.equal(f.stats.pairedCount,0);}
   const previous=await(await realFetch('http://127.0.0.1:8793/api/funds?date=2026-10-01&cached=1')).json();
   assert.ok(previous.items.every(f=>f.fromSaved&&f.requestedDate==='2026-10-01'&&f.date==='2026-10-02'));
   if(force)assert.equal(events.at(-1).data.recalculated,true);
  }
  const synchronized=await realFetch('http://127.0.0.1:8793/api/holdings/sync',{method:'POST',body:JSON.stringify({stream:true})});
  const events=(await synchronized.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.filter(e=>e.type==='progress'&&e.phase==='holdings'&&e.total===2).map(e=>e.completed),[0,1,2]);
  const report=events.at(-1).data;assert.equal(report.summary.unsupported,0);assert.equal(report.items.length,2);assert.equal(report.summary.updated,2);assert.ok(events.some(e=>e.phase==='recalculate'&&e.completed===2),'bonds refresh even without stock holdings');
  const lastReport=await (await realFetch('http://127.0.0.1:8793/api/holdings/sync')).json();
  assert.deepEqual(lastReport.items.map(i=>i.status),['updated','updated']);
  const restored=await (await realFetch('http://127.0.0.1:8793/api/holdings/sync',{method:'POST',body:JSON.stringify({})})).json();
  assert.deepEqual(restored.items.map(i=>i.status),['unchanged','unchanged']);assert.equal(restored.refreshSummary.total,2);assert.equal(restored.data.items.length,2);
 }finally{globalThis.fetch=realFetch;if(server)await new Promise(resolve=>server.close(resolve));}
});
