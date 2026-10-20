import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('index funds with zero stock allocation retain predictions, saved results stream first and fresh lists avoid upstream calls',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-index-load-'));process.env.PORT='8794';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 const names={'040046':'华安纳斯达克100ETF联接(QDII)A','000834':'大成纳斯达克100ETF联接(QDII)A','017641':'摩根标普500指数(QDII)人民币A'};
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:Object.keys(names),records:{},lastView:{'040046:2026-10-02':{code:'040046',name:names['040046'],index:true,date:'2026-10-02',record:{},indexQuote:{id:'NDX'},latestHoldings:{rows:[]}}}}));
 const realFetch=globalThis.fetch;let upstream=0,server;
 globalThis.fetch=async(input,options)=>{
  const url=String(input);if(url.startsWith('http://127.0.0.1:'))return realFetch(input,options);upstream++;
  await new Promise(resolve=>setTimeout(resolve,20));let value;
  if(url.includes('pingzhongdata')){const code=url.match(/(\d{6})\.js/)[1];return {ok:true,text:async()=>`var fS_name = "${names[code]}";var Data_assetAllocation = {"categories":["2026-06-30"],"series":[{"name":"股票占净比","data":[0]}]};`};}
  if(url.includes('lsjz'))value={TotalCount:1,Data:{LSJZList:[{FSRQ:'2026-09-29',DWJZ:'1',JZZZL:'0'}]}};
  else if(url.includes('usfqkline')){const ndx=url.includes('usNDX'),symbol=ndx?'usNDX':'usINX';value={data:{[symbol]:{qt:{[symbol]:['','',ndx?'.NDX':'.INX']},day:[['2026-09-29','100','100'],['2026-09-30','101','101'],['2026-10-01','102','102'],['2026-10-02','103','103']]}}};}
  else if(url.includes('stock/kline'))value={data:null};
  else if(url.includes('frankfurter'))value={rates:Object.fromEntries(['2026-09-29','2026-10-01','2026-10-02'].map(d=>[d,{USD:.15,HKD:1.2,JPY:20,KRW:200}]))};
  else throw Error('unexpected upstream '+url);
  return {ok:true,text:async()=>JSON.stringify(value),json:async()=>value};
 };
 try{
  ({server}=await import('../server.mjs'));if(!server.listening)await new Promise(r=>server.once('listening',r));
  const r=await realFetch('http://127.0.0.1:8794/api/funds?stream=1&date=2026-10-02');const events=(await r.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events[1].type,'snapshot');assert.equal(events[1].data.items.length,1);
  const funds=events.at(-1).data.items;assert.equal(funds.length,3);
  for(const f of funds){assert.equal(f.record.forecast.model.method,'index-proxy-v3');assert.ok(f.record.forecast.model.dailyReturn>0);assert.equal(f.modelError,null);assert.equal(f.record.evidence,undefined);assert.equal(f.evidenceCount,1);}
  const before=upstream;
  await realFetch('http://127.0.0.1:8794/api/funds?date=2026-10-02');assert.equal(upstream,before);
  const stored=JSON.parse(fs.readFileSync(process.env.QDII_DATA_FILE,'utf8'));assert.equal(stored.records['040046:2026-10-02'].evidence.length,1);
 }finally{globalThis.fetch=realFetch;if(server)await new Promise(resolve=>server.close(resolve));}
});
