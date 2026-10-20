import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('refresh skips settled NAVs, polls pending targets and checks the next target',{timeout:20000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-settled-'));process.env.PORT='0';process.env.QDII_STORAGE='json';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 const date='2026-10-13',actual={date,value:1.02,dailyReturn:.02},stamp='2026-10-01T00:00:00Z';
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:['123456','123457'],fundGroups:{'123456':'held','123457':'watch'},profiles:{'123456':{profile:{name:'测试股票基金',bond:false},fetchedAt:stamp}},records:{['123456:'+date]:{actual}},lastView:{['123456:'+date]:{code:'123456',name:'测试股票基金',date,asOf:date,latestNav:actual,checkedAt:stamp}}}));
 const real=globalThis.fetch;let app;const navCalls={};
 globalThis.fetch=async input=>{const url=String(input);if(url.startsWith('http://127.0.0.1:'))return real(input);
 if(url.includes('pingzhongdata'))return {ok:true,text:async()=> 'var fS_name = "测试股票基金";'};
 if(url.includes('lsjz')){const u=new URL(url),code=u.searchParams.get('fundCode');if(u.searchParams.get('pageSize')==='120')navCalls[code]=(navCalls[code]??0)+1;
 const rows=code==='123456'?[{FSRQ:date,DWJZ:'1.02',JZZZL:'2'},{FSRQ:'2026-10-12',DWJZ:'1',JZZZL:'0'}]:[{FSRQ:'2026-10-12',DWJZ:'1',JZZZL:'0'}];const result={TotalCount:rows.length,Data:{LSJZList:rows}};return {ok:true,text:async()=>JSON.stringify(result),json:async()=>result};}
 throw Error('mock unavailable');};
 try{app=await import('../server.mjs');await app.serverReady;const origin='http://127.0.0.1:'+app.server.address().port;
 const data=await real(origin+'/api/funds?date='+date).then(r=>r.json());assert.equal(data.items.length,2);assert.equal(navCalls['123456']??0,0);assert.equal(navCalls['123457'],1);assert.equal(data.items.find(f=>f.code==='123456').refreshReused,true);
 await real(origin+'/api/funds?date=2026-10-14&group=held').then(r=>r.json());assert.equal(navCalls['123456'],1,'next target polls again');
 await real(origin+'/api/recalculate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date})}).then(r=>r.json());assert.equal(navCalls['123456'],2,'forced recalculation bypasses settled shortcut');
 }finally{if(app)await app.shutdown();globalThis.fetch=real;fs.rmSync(dir,{recursive:true,force:true});}
});
