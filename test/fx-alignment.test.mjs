import test from 'node:test';
import assert from 'node:assert/strict';
import {fxMovement,configureFxStorage,clearProviderCache} from '../lib/provider.mjs';
import {configureQuoteCache} from '../lib/quote-cache.mjs';

test('T日中间价优先于更快备用，排除T+1汇率，同一区间并发与重读共用快照',async()=>{
 const real=globalThis.fetch;let official=0,backup=0;const saved=new Map();configureQuoteCache(null);configureFxStorage({read:k=>saved.get(k),write:(k,v)=>saved.set(k,v)});
 try{
  globalThis.fetch=async url=>{
   if(String(url).includes('frankfurter')){backup++;return {ok:true,text:async()=>JSON.stringify({rates:{'2026-10-09':{USD:1/7},'2026-10-12':{USD:1/7.1}}})};}
   official++;await new Promise(r=>setTimeout(r,2800));return {ok:true,text:async()=>JSON.stringify({data:{klines:['2026-10-09,0,7,0,0','2026-10-12,0,6.93,0,0','2026-10-13,0,6,0,0']}})};
  };
  const [a,b]=await Promise.all([fxMovement('USD','2026-10-09','2026-10-12'),fxMovement('USD','2026-10-09','2026-10-12')]);
  assert.equal(a,b);assert.equal(a.target.date,'2026-10-12');assert.equal(a.target.close,6.93);assert.ok(Math.abs(a.return+.01)<1e-12);assert.equal(a.source,'人民币中间价');assert.equal(official,1);assert.equal(backup,0);
  globalThis.fetch=async()=>{throw Error('offline');};assert.equal(await fxMovement('USD','2026-10-09','2026-10-12'),a);
 }finally{globalThis.fetch=real;configureFxStorage(null);await clearProviderCache();}
});

test('中间价失败才启用备用并明确标记参考口径',async()=>{
 const real=globalThis.fetch;configureQuoteCache(null);
 try{
  globalThis.fetch=async url=>{if(!String(url).includes('frankfurter'))throw Error('offline');return {ok:true,text:async()=>JSON.stringify({rates:{'2026-10-09':{USD:1/7},'2026-10-12':{USD:1/7.1}}})};};
  const rate=await fxMovement('USD','2026-10-09','2026-10-12');assert.equal(rate.referenceOnly,true);assert.match(rate.source,/ECB/);
 }finally{globalThis.fetch=real;await clearProviderCache();}
});
