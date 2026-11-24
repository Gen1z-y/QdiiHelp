import test from 'node:test';
import assert from 'node:assert/strict';
import {fundProfile,navs} from '../lib/provider.mjs';

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

test('official NAV retries a connection reset and reports persistent DNS errors with the source host',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>{
   if(++calls===1)throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});
   const result={Data:{LSJZList:[{FSRQ:'2026-11-23',DWJZ:'1.03',JZZZL:'1'}]}};
   return {ok:true,text:async()=>JSON.stringify(result)};
  };
  const results=await Promise.all([navs('987651',true),navs('987651',true)]);
  assert.deepEqual(results.map(rows=>rows[0].value),[1.03,1.03]);
  assert.equal(calls,2);
  calls=0;
  globalThis.fetch=async()=>{calls++;throw new TypeError('fetch failed',{cause:{code:'ENOTFOUND'}});};
  await assert.rejects(navs('987652',true),/api\.fund\.eastmoney\.com.*域名解析失败.*ENOTFOUND/);
  assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
