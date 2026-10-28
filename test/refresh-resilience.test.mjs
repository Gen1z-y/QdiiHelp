import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('whole-fund deadline releases preflight slots, discards late profiles and retries failures only next round',{timeout:10000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-resilience-'));const file=path.join(dir,'state.json');
 process.env.PORT='0';process.env.QDII_STORAGE='json';process.env.QDII_DATA_FILE=file;
 fs.writeFileSync(file,JSON.stringify({version:1,watchlist:['111111','222222','333333','444444','555555'],records:{},lastView:{}}));
 const realFetch=globalThis.fetch,realTimer=globalThis.setTimeout;const releases=[];let app,recovered=false,profileCalls=0;
 globalThis.setTimeout=(fn,ms,...args)=>realTimer(fn,ms>80000&&ms<=90000?150:ms===1000||ms===2000?1:ms,...args);
 globalThis.fetch=async(input,options)=>{
  const url=String(input);if(url.startsWith('http://127.0.0.1:'))return realFetch(input,options);
  if(url.includes('pingzhongdata')){
   if(/111111|222222|333333/.test(url)&&!recovered)return new Promise(resolve=>releases.push(()=>resolve({ok:true,text:async()=> 'var fS_name = "过期名称";'})));
   if(url.includes('555555')){profileCalls++;if(!recovered)throw new TypeError('fetch failed');}
   return {ok:true,text:async()=> 'var fS_name = "恢复后股票基金";'};
  }
  if(url.includes('lsjz'))return {ok:true,text:async()=>JSON.stringify({TotalCount:2,Data:{LSJZList:[{FSRQ:'2026-10-13',DWJZ:'1.01',JZZZL:'1'},{FSRQ:'2026-10-12',DWJZ:'1',JZZZL:'0'}]}})};
  throw Error('mock upstream unavailable');
 };
 try{
  app=await import('../server.mjs');await app.serverReady;const origin='http://127.0.0.1:'+app.server.address().port;
  const first=await realFetch(origin+'/api/funds?stream=1').then(r=>r.text());const events=first.trim().split('\n').map(l=>JSON.parse(l));const data=events.at(-1).data;
  assert.equal(data.items.length,5);
  for(const code of ['111111','222222','333333'])assert.match(data.items.find(f=>f.code===code).error,/超时/);
  assert.equal(data.items.find(f=>f.code==='444444').error,null,'next fund completes after all three preflight slots time out');
  assert.equal(profileCalls,3,'failed selection profile is reused by update, rather than retried three more times');
  recovered=true;for(const release of releases)release();await new Promise(r=>realTimer(r,30));
  const second=await realFetch(origin+'/api/funds').then(r=>r.json());
  assert.equal(second.items.find(f=>f.code==='111111').name,'恢复后股票基金','late preflight must not commit its stale profile');
  assert.equal(profileCalls,4,'a new round can recover');
 }finally{for(const release of releases)release();if(app)await app.shutdown();globalThis.fetch=realFetch;globalThis.setTimeout=realTimer;fs.rmSync(dir,{recursive:true,force:true});}
});
