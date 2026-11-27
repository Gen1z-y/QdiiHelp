import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import {fundProfile,navs} from '../lib/provider.mjs';
import {fetchHistory} from '../lib/history.mjs';

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
  await assert.rejects(navs('987652',true),/api\.fund\.eastmoney\.com.*域名解析失败.*ENOTFOUND.*fundmobapi\.eastmoney\.com/);
  assert.equal(calls,3);
 }finally{globalThis.fetch=original;}
});

const dnsError=()=>new TypeError('fetch failed',{cause:{code:'ENOTFOUND'}});
const mobileResult=(rows,total,bonus=[])=>new Response(JSON.stringify({
 Success:true,ErrCode:0,TotalCount:total,Datas:rows,Expansion:{BonusList:bonus},
}));
const navRow=(date,value,rate)=>({FSRQ:date,DWJZ:value,JZZZL:rate,LJJZ:'2.50'});

test('official NAV falls back on DNS failure and preserves published adjustments',async t=>{
 const original=globalThis.fetch;
 t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async input=>{
  const url=new URL(input);
  if(url.hostname==='api.fund.eastmoney.com')throw dnsError();
  assert.equal(url.hostname,'fundmobapi.eastmoney.com');
  assert.equal(url.searchParams.get('FCODE'),'987653');
  assert.equal(url.searchParams.get('pageSize'),'120');
  return mobileResult([navRow('2026-11-23','1.03','-0.64'),navRow('2026-11-20','1.06','0')],2,[
   {FSRQ:'2026-11-23',Remarks:'份额折算'},{FSRQ:'2026-11-20',Remarks:'分红'},
  ]);
 };
 const [latest,prev]=await navs('987653',true);
 assert.equal(latest.value,1.03);
 assert.equal(latest.cumulativeNav,2.5);
 assert.ok(Math.abs(latest.dailyReturn-(-0.0064))<1e-10);
 assert.equal(latest.adjustment,true);
 assert.equal(prev.distribution,'分红');
 assert.equal(prev.adjustment,false);
 assert.equal(prev.dailyReturn,0);
});

test('history downloads and saves every fallback page after the primary hostname fails',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'qdii-nav-history-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const days=Array.from({length:20},(_,i)=>'2026-11-'+String(27-i).padStart(2,'0'));
 let primaryCalls=0;
 const fetcher=async input=>{
  const url=new URL(input);
  if(url.hostname==='api.fund.eastmoney.com'){primaryCalls++;throw dnsError();}
  assert.equal(url.hostname,'fundmobapi.eastmoney.com');
  assert.equal(url.searchParams.get('FCODE'),'987654');
  assert.equal(url.searchParams.get('pageSize'),'20');
  switch(url.searchParams.get('pageIndex')){
   case '1':return mobileResult(days.map(d=>navRow(d,'1.03','0')),21);
   case '2':return mobileResult([navRow('2026-11-07','1.01','-1.25')],21,[{FSRQ:'2026-11-07',Remarks:'份额折算'}]);
   default:throw new Error('意外的净值分页');
  }
 };
 const result=await fetchHistory('987654',root,{fetcher,force:true});
 assert.equal(primaryCalls,1);
 assert.equal(result.historyComplete,true);
 assert.equal(result.rows.length,21);
 assert.deepEqual(result.rows.at(-1),{date:'2026-11-07',value:1.01,cumulativeNav:2.5,adjustment:true,dailyReturn:-0.0125});
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'data','history','987654.json'),'utf8')),result);
});

test('official NAV uses HTTPS DNS after both Eastmoney hosts fail system resolution',async t=>{
 const original=globalThis.fetch;
 t.after(()=>{globalThis.fetch=original;});
 const resolverCalls=[];
 const fetcher=async input=>{
  const url=new URL(input);
  if(url.hostname!=='223.5.5.5')throw dnsError();
  resolverCalls.push(Object.fromEntries(url.searchParams));
  return new Response(JSON.stringify({
   Status:0,Answer:[
    {name:'fundmobapi.eastmoney.com.',type:5,TTL:300,data:'cdn.example.'},
    {name:'cdn.example.',type:1,TTL:200,data:'192.0.2.10'},
   ],
  }));
 };
 globalThis.fetch=fetcher;
 const secureCalls=[];
 t.mock.method(https,'get',(url,options,onResponse)=>{
  assert.equal(url.hostname,'fundmobapi.eastmoney.com');
  assert.equal(options.rejectUnauthorized,true);
  options.lookup(url.hostname,{all:true},(error,addresses)=>{
   assert.ifError(error);
   assert.deepEqual(addresses,[{address:'192.0.2.10',family:4}]);
  });
  secureCalls.push(url.searchParams.get('FCODE'));
  const response=Readable.from([Buffer.from(JSON.stringify({
   Success:true,ErrCode:0,TotalCount:1,Datas:[navRow('2026-11-23','1.03','-0.64')],Expansion:{BonusList:[]},
  }))]);
  response.statusCode=200;
  queueMicrotask(()=>onResponse(response));
  return new EventEmitter();
 });
 const [first,second]=await Promise.all([navs('987659',true),navs('987660',true)]);
 assert.equal(first[0].value,1.03);
 assert.equal(second[0].value,1.03);
 assert.deepEqual(resolverCalls,[{name:'fundmobapi.eastmoney.com',type:'A'}]);
 assert.deepEqual(secureCalls.sort(),['987659','987660']);
});
