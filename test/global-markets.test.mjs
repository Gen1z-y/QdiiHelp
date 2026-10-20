import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBars,globalIndex,closingValue,parseSinaQuote,marketDisplay} from '../lib/global-markets.mjs';

test('European Sina quotes after Beijing midnight use the local session date, including winter time',()=>{
 for(const [id,symbol,time,stamp] of [
  ['DAX','b_DAX','00:00:19','2026-10-09T16:00:19.000Z'],
  ['CAC','b_CAC','00:05:46','2026-10-09T16:05:46.000Z']
 ]){
  const latest=parseSinaQuote(`var hq_str_${symbol}="Index,100,1,1,,,2026-10-10,${time}";`,{id});
  assert.equal(latest.date,'2026-10-09');assert.equal(latest.asOf,stamp);
  const display=marketDisplay({id,rows:[],latest},new Date('2026-10-11T12:00:00Z'));
  assert.equal(display.kind,'closed');assert.equal(display.quote.close,100);assert.equal(display.quote.change,.01);
  const winter=parseSinaQuote(`var hq_str_${symbol}="Index,101,1,1,,,2026-12-05,01:05:00";`,{id});
  assert.equal(winter.date,'2026-12-04');
  assert.equal(closingValue(id,[],winter,new Date('2026-12-05T02:00:00Z')),winter);
 }
});

test('Sina date conversion preserves Asian dates and excludes unfinished European quotes',()=>{
 const tokyo=parseSinaQuote('var hq_str_b_NKY="Index,100,1,1,,,2026-10-09,14:30:01";',{id:'N225'});
 assert.equal(tokyo.date,'2026-10-09');
 assert.equal(closingValue('N225',[],tokyo,new Date('2026-10-09T07:00:00Z')),tokyo);
 const intraday=parseSinaQuote('var hq_str_b_DAX="Index,100,1,1,,,2026-10-09,20:00:00";',{id:'DAX'});
 assert.equal(closingValue('DAX',[],intraday,new Date('2026-10-09T20:00:00Z')),null);
});

test('closing points exclude intraday quotes and unfinished daily bars',()=>{
 const rows=[{date:'2026-10-05',close:100},{date:'2026-10-06',close:102},{date:'2026-10-07',close:103}];
 const quote={date:'2026-10-07',close:103,change:.01,asOf:'2026-10-07T04:00:00Z'};
 assert.deepEqual(closingValue('N225',rows,quote,new Date('2026-10-07T05:00:00Z')),{date:'2026-10-06',close:102,change:102/100-1});
 assert.equal(closingValue('N225',[],quote,new Date('2026-10-07T05:00:00Z')),null);
 const closed={...quote,asOf:'2026-10-07T06:30:00Z'};
 assert.equal(closingValue('N225',rows,closed,new Date('2026-10-07T07:00:00Z')),closed);
});
test('global index bars discard invalid values, deduplicate and sort dates',()=>{
 assert.deepEqual(normalizeBars([{date:'2026-09-30',close:0},{date:'bad',close:10},{date:'2026-09-29',close:99},{date:'2026-09-28',close:95},{date:'2026-09-29',close:100}]),[{date:'2026-09-28',close:95},{date:'2026-09-29',close:100}]);
});
test('global indices preserve cache on failure and do not fabricate missing prices',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>({ok:true,json:async()=>({data:{code:'FTSE',klines:['2026-09-29,99,100','2026-09-30,100,102']}})});
  const fresh=await globalIndex('FTSE',true);assert.equal(fresh.latest.close,102);assert.ok(Math.abs(fresh.latest.change-.02)<1e-10);
  globalThis.fetch=async()=>{throw new Error('offline');};
  const stale=await globalIndex('FTSE',true);assert.equal(stale.stale,true);assert.equal(stale.latest.close,102);assert.ok(stale.error);
  const missing=await globalIndex('DAX',true);assert.equal(missing.latest,undefined);assert.ok(missing.error);
  await assert.rejects(globalIndex('UNKNOWN'),/不支持/);
 }finally{globalThis.fetch=original;}
});


test('open session uses timestamped latest price; close, lunch and stale quotes are distinguished',async()=>{
 const {marketDisplay}=await import('../lib/global-markets.mjs');
 const rows=[{date:'2026-10-07',close:100},{date:'2026-10-08',close:102}];
 const quote={date:'2026-10-09',close:105,change:.03,asOf:'2026-10-09T14:00:00Z'};
 const data={id:'SPX',rows,latest:quote};
 assert.equal(marketDisplay(data,new Date('2026-10-09T14:01:00Z')).kind,'live');
 assert.equal(marketDisplay(data,new Date('2026-10-09T14:01:00Z')).quote.close,105);
 assert.equal(marketDisplay({...data,stale:true},new Date('2026-10-09T14:01:00Z')).kind,'delayed');
 assert.equal(marketDisplay(data,new Date('2026-10-09T14:10:00Z')).kind,'delayed');
 const close={...data,latest:{...quote,asOf:'2026-10-09T20:00:00Z'}};
 assert.equal(marketDisplay(close,new Date('2026-10-09T21:00:00Z')).kind,'closed');
 assert.equal(marketDisplay(close,new Date('2026-10-09T21:00:00Z')).quote.close,105);
 const lunch={id:'SH',rows,latest:{...quote,asOf:'2026-10-09T03:30:00Z'}};
 assert.equal(marketDisplay(lunch,new Date('2026-10-09T04:00:00Z')).kind,'break');
 assert.equal(marketDisplay({id:'SPX',rows,latest:{...quote,asOf:null}},new Date('2026-10-09T14:01:00Z')).quote.close,102);
 assert.equal(marketDisplay(close,new Date('2026-10-10T14:01:00Z')).kind,'closed');
 assert.equal(marketDisplay({id:'SH',rows:[{date:'2026-09-29',close:100},{date:'2026-09-30',close:102}],latest:{...quote,date:'2026-10-02',asOf:'2026-10-02T02:00:00Z'}},new Date('2026-10-02T02:01:00Z')).kind,'closed');
});

test('global market progress counts each completed index including failed sources',async()=>{
 const {globalMarkets,marketDefinitions}=await import('../lib/global-markets.mjs');
 const old=globalThis.fetch,events=[];
 try{
  globalThis.fetch=async()=>{throw Error('offline');};
  const result=await globalMarkets(true,p=>events.push(p));
  assert.equal(result.items.length,marketDefinitions.length);
  assert.deepEqual(events.map(p=>p.completed),Array.from({length:marketDefinitions.length+1},(_,i)=>i));
  assert.equal(new Set(events.slice(1).map(p=>p.item.id)).size,marketDefinitions.length);
 }finally{globalThis.fetch=old;}
});

test('closed sessions reuse cached kline history; force refetches',async()=>{
 const original=globalThis.fetch,urls=[];
 globalThis.fetch=async url=>{
  urls.push(String(url));
  if(String(url).includes('push2his'))return {ok:true,json:async()=>({data:{code:'399001',klines:['2026-09-29,1,99','2026-09-30,1,100','2026-10-09,1,102']}})};
  if(String(url).includes('qt.gtimg.cn'))return {ok:true,arrayBuffer:async()=>new TextEncoder().encode('v_sz399001="0~SZ~399001~102~100~'+Array(25).fill('0').join('~')+'~20261009150000~"').buffer};
  throw new Error('unexpected '+url);
 };
 try{
  const a=await globalIndex('SZ',true);
  assert.equal(urls.filter(u=>u.includes('push2his')).length,1);
  assert.equal(urls.filter(u=>u.includes('qt.gtimg.cn')).length,1);
  assert.equal(a.latest.close,102);
  const b=await globalIndex('SZ');
  assert.equal(urls.filter(u=>u.includes('push2his')).length,1,'kline not refetched within cache window');
  assert.equal(urls.filter(u=>u.includes('qt.gtimg.cn')).length,1,'quote not refetched within cache window');
  assert.equal(b.latest.close,a.latest.close);
  await globalIndex('SZ',true);
  assert.equal(urls.filter(u=>u.includes('push2his')).length,2,'force refetches kline');
 }finally{globalThis.fetch=original;}
});
