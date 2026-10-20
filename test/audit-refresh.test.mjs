import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const wait=async check=>{for(let i=0;i<300;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('test condition timed out');};
test('group histories queue during an active sync and single-fund sync serializes refresh with the holiday as-of',{timeout:25000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-audit-refresh-'));process.env.PORT='0';process.env.QDII_STORAGE='json';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 const seed={asOf:'2026-06-30',rows:[{name:'Test',code:'TEST',secid:'105.TEST',weight:20}],fetchedAt:'2026-10-01T00:00:00Z'};
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:['111111','222222'],fundGroups:{'111111':'held','222222':'watch'},records:{},lastView:{},holdingsSnapshots:{'111111':seed,'222222':seed}}));
 const RealDate=Date,realFetch=globalThis.fetch;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-05T12:00:00+08:00']));}static now(){return RealDate.parse('2026-10-05T12:00:00+08:00');}};
 let app,releaseHistory,historyStarted=false,profileStarted=false,holdProfile=false,releaseProfile;
 const historyGate=new Promise(r=>releaseHistory=r),profileGate=new Promise(r=>releaseProfile=r),histories=new Set();let navCalls=0;
 globalThis.fetch=async(input,options)=>{
  const u=String(input);if(u.startsWith('http://127.0.0.1:'))return realFetch(input,options);
  if(u.includes('pingzhongdata')){if(holdProfile){profileStarted=true;await profileGate;}return {ok:true,text:async()=> 'var fS_name = "测试全球股票基金A";'};}
  if(u.includes('FundArchivesDatas')){const html="<a title='测试全球股票基金A'>基金</a>截止至：<font>2026-06-30</font><tbody><tr><td>1</td><td><a href='//quote.eastmoney.com/unify/r/105.TEST'>TEST</a></td><td>测试股票</td><td>20%</td></tr></tbody>";return {ok:true,text:async()=> 'var apidata={content:'+JSON.stringify(html)+'};'};}
  let j;
  if(u.includes('lsjz')){const q=new URL(u),code=q.searchParams.get('fundCode');if(q.searchParams.get('pageSize')==='20'){histories.add(code);if(code==='111111'){historyStarted=true;await historyGate;}}else navCalls++;
   j={TotalCount:2,Data:{LSJZList:[{FSRQ:'2026-09-30',DWJZ:'1',JZZZL:'0'},{FSRQ:'2026-09-29',DWJZ:'1',JZZZL:'0'}]}};
  }else if(u.includes('push2his'))j={data:{klines:(u.includes('120.')?[['2026-09-29',7],['2026-09-30',7],['2026-10-01',7],['2026-10-02',7]]:[['2026-09-29',100],['2026-09-30',100],['2026-10-01',101],['2026-10-02',102]]).map(([d,c])=>`${d},1,${c},1,1,1,1,1,0`)}};
  else throw Error('unconfigured mock');
  return {ok:true,text:async()=>JSON.stringify(j),json:async()=>j};
 };
 try{
  app=await import('../server.mjs');await app.serverReady;const origin='http://127.0.0.1:'+app.server.address().port;
  const get=route=>realFetch(origin+route).then(async r=>{const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;});
  await get('/api/funds?group=held');await wait(()=>historyStarted);await get('/api/funds?group=watch');
  releaseHistory();await wait(()=>!app.runtimeStatus().operations.historySync);
  assert.deepEqual([...histories].sort(),['111111','222222'],'the second group must not lose its background history sync');
  holdProfile=true;const single=realFetch(origin+'/api/holdings/sync-one',{method:'POST',body:JSON.stringify({code:'111111'})}).then(r=>r.json());await wait(()=>profileStarted);
  assert.equal(app.runtimeStatus().operations.holdingsSync,true);
  const rejected=await realFetch(origin+'/api/holdings/sync-one',{method:'POST',body:JSON.stringify({code:'222222'})});assert.equal(rejected.status,400);await rejected.text();
  const before=navCalls,refresh=get('/api/funds?group=held');await wait(()=>app.runtimeStatus().operations.refreshes>0);assert.equal(navCalls,before,'refresh waits behind the single-fund sync');
  releaseProfile();const one=await single;assert.equal(one.item.date,'2026-10-08');assert.equal(one.item.navEstimate.asOf,'2026-10-02');assert.equal(one.item.navEstimate.partial,true);assert.ok(Number.isFinite(one.item.navEstimate.return));await refresh;
 }finally{releaseHistory();releaseProfile();if(app)await app.shutdown();globalThis.fetch=realFetch;globalThis.Date=RealDate;fs.rmSync(dir,{recursive:true,force:true});}
});
