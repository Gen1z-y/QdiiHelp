import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('旧区间缓存普通刷新后补齐假期说明，保留封存预测并允许主源接管',{timeout:20000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-nav-repair-'));
 process.env.PORT='0';process.env.QDII_STORAGE='json';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 const code='018147',date='2026-10-20',actual={date,value:2.0744,dailyReturn:null,intervalReturn:.009588,returnFrom:'2026-10-16',returnTo:date,returnSource:'腾讯基金'},forecast={date,base:{date:'2026-10-19',value:2.05},holdingsDate:'2026-06-30',
  rows:[{weight:40,rmbReturn:.007,dailyRmbReturn:.007,secid:'1.TEST',currency:'CNY',stock:{base:{date:'2026-10-19'},target:{date}},dailyBaseDate:'2026-10-19',dailyStock:{base:{date:'2026-10-19'},target:{date}}}],
  model:{value:2.07,return:.007,dailyReturn:.007,method:'market-close-v4'},calculatedAt:'2026-10-21T01:00:00Z'};
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:[code],fundGroups:{[code]:'watch'},
  profiles:{[code]:{profile:{name:'测试基金',bond:false},fetchedAt:new Date().toISOString()}},
  records:{[code+':'+date]:{actual,forecast,sealedAt:'2026-10-20T08:00:00Z'}},
  lastView:{[code+':'+date]:{code,name:'测试基金',date,asOf:date,latestNav:actual,checkedAt:new Date().toISOString()}}}));
 const real=globalThis.fetch;let app,complete=false,navCalls=0;
 globalThis.fetch=async input=>{
  const url=String(input);if(url.startsWith('http://127.0.0.1:'))return real(input);
  if(url.includes('pingzhongdata'))return {ok:true,text:async()=>'var fS_name = "测试基金";'};
  if(url.includes('lsjz')){if(new URL(url).searchParams.get('pageSize')==='120')navCalls++;
   const payload={TotalCount:2,Data:{LSJZList:[{FSRQ:date,DWJZ:'2.0744',LJJZ:'2.0744',JZZZL:complete?'0.96':''},{FSRQ:'2026-10-16',DWJZ:'2.0547',LJJZ:'2.0547',JZZZL:'-2.78'}]}};
   return {ok:true,text:async()=>JSON.stringify(payload),json:async()=>payload};
  }
  if(url.includes('qt.gtimg.cn'))return {ok:true,text:async()=>`v_jj018147="018147~测试基金~0~0~~2.0744~2.0744~0.9588~2026-10-20~";`};
  throw Error('未配置接口');
 };
 try{
  app=await import('../server.mjs');await app.serverReady;
  const get=()=>real('http://127.0.0.1:'+app.server.address().port+'/api/funds?date='+date).then(r=>r.json());
  const first=(await get()).items[0];assert.equal(first.refreshReused,false);assert.equal(first.record.actual.dailyReturn,null);
  assert.equal(first.record.actual.intervalReturn,.009588);assert.equal(first.record.actual.returnPeriod,'fund-valuation');assert.equal(first.record.actual.returnReason,'重阳节');assert.equal(first.record.actual.returnFrom,'2026-10-16');
  assert.deepEqual(first.record.forecast,forecast);assert.equal(navCalls,1);
  complete=true;const next=(await get()).items[0];assert.equal(next.record.actual.dailyReturn,.0096);
  assert.equal(next.record.actual.returnSource,undefined);assert.equal(next.record.actual.returnPeriod,undefined);assert.equal(next.record.actual.intervalReturn,undefined);assert.equal(navCalls,2);
  const again=(await get()).items[0];assert.equal(again.refreshReused,true);assert.equal(navCalls,2);
 }finally{if(app)await app.shutdown();globalThis.fetch=real;fs.rmSync(dir,{recursive:true,force:true});}
});
