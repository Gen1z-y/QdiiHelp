import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {performance} from 'node:perf_hooks';
test('formal NAV and independent funds stream before slow top FX; foreign estimates still require valid FX',{timeout:20000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-order-'));process.env.PORT='0';process.env.QDII_DATA_FILE=path.join(dir,'state.json');process.env.QDII_STORAGE='json';
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:['006337','040046'],fundGroups:{'006337':'held','040046':'watch'},records:{},lastView:{}}));
 const realFetch=globalThis.fetch;let releaseFx,invalidFx=false,fxStarted=false,server,app;const gate=new Promise(r=>releaseFx=r),navCalls={};let holdHistory=false,historyStarted=false,releaseHistory;const historyGate=new Promise(r=>releaseHistory=r);
 globalThis.fetch=async(input,options)=>{
  const url=String(input);if(url.startsWith('http://127.0.0.1:'))return realFetch(input,options);
  if(url.includes('pingzhongdata'))return {ok:true,text:async()=> 'var fS_name = "'+(url.includes('040046')?'纳斯达克100ETF联接':'测试债券基金')+'";'};
  let result;
  if(url.includes('lsjz')){const parsed=new URL(url);if(holdHistory&&parsed.searchParams.get('pageSize')==='20'){historyStarted=true;await historyGate;}const code=parsed.searchParams.get('fundCode');navCalls[code]=(navCalls[code]??0)+1;result={TotalCount:2,Data:{LSJZList:[{FSRQ:'2026-10-13',DWJZ:'1.01',JZZZL:'1'},{FSRQ:'2026-10-12',DWJZ:'1',JZZZL:'0'}]}};}
  else if(url.includes('120.')){fxStarted=true;await gate;result=invalidFx?{data:null}:{data:{klines:['2026-10-12,1,7,1,1,1,1,1,0','2026-10-13,1,7,1,1,1,1,1,0','2026-10-14,1,7,1,1,1,1,1,0']}};}
  else if(url.includes('usfqkline'))result={data:{usNDX:{qt:{usNDX:['','','.NDX']},day:[['2026-10-09','99','99'],['2026-10-12','100','100'],['2026-10-13','110','110'],['2026-10-14','111','111']]}}};
  else throw Error('test upstream unavailable');
  return {ok:true,text:async()=>JSON.stringify(result),json:async()=>result};
 };
 const wait=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('stream did not progress before FX');};
 try{
  app=await import('../server.mjs');server=app.server;await app.serverReady;const origin='http://127.0.0.1:'+server.address().port,start=performance.now(),events=[];
  const response=await realFetch(origin+'/api/funds?stream=1&date=2026-10-13');
  const collect=(async()=>{const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';for(;;){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line)events.push({...JSON.parse(line),observedMs:performance.now()-start});}if(done)break;}})();
  await wait(()=>fxStarted&&events.some(e=>e.item?.code==='006337')&&events.some(e=>e.official?.code==='040046'));
  assert.ok(!events.some(e=>e.item?.code==='040046'),'foreign estimate waits for its required FX');assert.ok(!events.some(e=>e.type==='result'));
  releaseFx();await collect;const completed=events.at(-1);assert.equal(completed.type,'result');assert.equal(completed.data.items.length,2);assert.equal(completed.data.items.find(f=>f.code==='006337').record.actual.dailyReturn,.01);
  assert.ok(Math.abs(completed.data.items.find(f=>f.code==='040046').analysis.model.return-.1)<1e-10);
  const before=navCalls['006337'];await realFetch(origin+'/api/funds?group=bond');assert.equal(navCalls['006337']-before,1,'bond auto-date selection and update share a NAV request');
  invalidFx=true;const provider=await import('../lib/provider.mjs');await provider.clearProviderCache();provider.configureFxStorage({read:()=>null,write:()=>{}});
  const bad=await realFetch(origin+'/api/funds?date=2026-10-14&group=watch').then(r=>r.json());const foreign=bad.items[0];assert.ok(!foreign.record?.forecast);assert.match(foreign.modelError,/汇率|行情|日期|upstream/);assert.equal(foreign.latestNav.date,'2026-10-13');
  await wait(()=>!app.runtimeStatus().operations.historySync);fs.rmSync(path.join(dir,'data','history'),{recursive:true,force:true});holdHistory=true;
  let notification;const tray=app.refreshFromTray().then(run=>notification=run);await wait(()=>historyStarted&&notification);
  assert.equal(notification.historyPending,true);assert.equal(app.runtimeStatus().operations.historySync,true);
  const saved=JSON.parse(fs.readFileSync(process.env.QDII_DATA_FILE,'utf8'));assert.ok(saved.refreshRuns.some(r=>r.id===notification.id&&r.finishedAt),'current result is persisted before notification');
  releaseHistory();await tray;
  t.diagnostic(JSON.stringify({formalBeforeFx:true,independentFundBeforeFx:true,bondNavRequestsPerAutoRefresh:1,foreignEstimateValidated:true,trayCompletesWhileHistoryPending:true}));
 }finally{releaseFx();releaseHistory();if(app)await app.shutdown();globalThis.fetch=realFetch;fs.rmSync(dir,{recursive:true,force:true});}
});
