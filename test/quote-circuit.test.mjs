import test from 'node:test';
import assert from 'node:assert/strict';
import {QuoteCircuit} from '../lib/quote-circuit.mjs';
import {bars,clearProviderCache} from '../lib/provider.mjs';
const network=()=>new TypeError('fetch failed');

test('quote cooldown separates FX, ignores symbol errors and recovers through one probe',async()=>{
 let now=0;const circuit=new QuoteCircuit({now:()=>now,cooldownMs:50});let calls=0;
 const fail=()=>{calls++;throw network();};
 await assert.rejects(circuit.run('stock',fail));
 assert.equal(await circuit.run('fx',async()=>7),7);
 await assert.rejects(circuit.run('stock',()=>{throw Object.assign(Error('not found'),{status:404});}));
 await assert.rejects(circuit.run('stock',fail));
 await assert.rejects(circuit.run('stock',fail));
 await assert.rejects(circuit.run('stock',fail),/暂缓请求/);assert.equal(calls,3);
 now=51;let release;const probe=circuit.run('stock',()=>new Promise(r=>release=r));
 await assert.rejects(circuit.run('stock',fail),/暂缓请求/);release(8);assert.equal(await probe,8);
 assert.equal(await circuit.run('stock',async()=>9),9);
 for(let i=0;i<3;i++)await assert.rejects(circuit.run('stock',fail));
 now=102;await assert.rejects(circuit.run('stock',fail));
 now=153;assert.equal(await circuit.run('stock',async()=>10),10);
});

test('valid memory cache is usable during stock cooldown; FX and malformed symbols stay independent',async()=>{
 const original=globalThis.fetch;let calls=[];
 try{
  await clearProviderCache();
  globalThis.fetch=async input=>{const url=String(input);calls.push(url);
   if(url.includes('bad'))throw network();
   if(url.includes('malformed'))return {ok:true,text:async()=>'{'};
   return {ok:true,text:async()=>JSON.stringify({data:{klines:['2026-10-13,100,101,102,99,1,1,1,1']}})};
  };
  await assert.rejects(bars('105.malformed','2026-10-13'));
  assert.equal((await bars('105.good','2026-10-13')).length,1);
  for(let i=0;i<3;i++)await assert.rejects(bars('105.bad'+i,'2026-10-13'));
  const before=calls.length;
  assert.equal((await bars('105.good','2026-10-13')).length,1);assert.equal(calls.length,before);
  await assert.rejects(bars('105.other','2026-10-13'),/暂缓请求/);assert.equal(calls.length,before);
  assert.equal((await bars('120.USDCNYC','2026-10-13')).length,1);assert.equal(calls.length,before+1);
 }finally{globalThis.fetch=original;await clearProviderCache();}
});

test('late failures from an older request cannot close a new recovery probe',async()=>{
 let now=0,releaseOld,releaseProbe;const circuit=new QuoteCircuit({threshold:1,cooldownMs:10,now:()=>now});
 const old=circuit.run('stock',()=>new Promise((_,reject)=>releaseOld=()=>reject(network())));
 await assert.rejects(circuit.run('stock',()=>{throw network();}));
 now=11;const probe=circuit.run('stock',()=>new Promise(resolve=>releaseProbe=resolve));
 releaseOld();await assert.rejects(old);
 await assert.rejects(circuit.run('stock',async()=>99),/暂缓请求/);
 releaseProbe(1);assert.equal(await probe,1);assert.equal(await circuit.run('stock',async()=>2),2);
});
