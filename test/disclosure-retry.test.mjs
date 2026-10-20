import test from 'node:test';
import assert from 'node:assert/strict';
import {fundProfile} from '../lib/provider.mjs';

test('disclosure requests retry transient failures and identify persistent connection errors',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>{if(++calls===1)throw new TypeError('fetch failed');return {ok:true,text:async()=> 'var fS_name = "测试股票基金A";'};};
  assert.equal((await fundProfile('987651',{force:true})).name,'测试股票基金A');assert.equal(calls,2);
  calls=0;globalThis.fetch=async()=>{calls++;throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});};
  await assert.rejects(fundProfile('987652',{force:true}),/基金资料接口请求失败.*ECONNRESET/);
  assert.equal(calls,3);
 }finally{globalThis.fetch=original;}
});
