import test from 'node:test';import assert from 'node:assert/strict';import {indexClose,clearIndexCache} from '../lib/indices.mjs';
test('different fund bases share the same index series while keeping per-base date validation',async()=>{
 const original=globalThis.fetch;let calls=0;await clearIndexCache();
 globalThis.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,20));return {ok:true,json:async()=>({data:{usNDX:{qt:{usNDX:['','','.NDX']},day:[['2026-10-09','100','100'],['2026-10-12','101','101'],['2026-10-13','103','103']]}}})};};
 try{
  const [a,b]=await Promise.all([indexClose('NDX','2026-10-13','2026-10-09'),indexClose('NDX','2026-10-13','2026-10-12')]);assert.equal(calls,1);assert.equal(a.baseClose,100);assert.equal(b.baseClose,101);assert.equal(a.close,b.close);
  await assert.rejects(indexClose('NDX','2026-10-13','2026-09-01'),/基准日/);assert.equal(calls,1);
  await clearIndexCache();await indexClose('NDX','2026-10-13','2026-10-12');assert.equal(calls,2);
 }finally{globalThis.fetch=original;await clearIndexCache();}
});
