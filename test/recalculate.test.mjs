import test from 'node:test';
import assert from 'node:assert/strict';
import {fundProfile,clearProviderCache} from '../lib/provider.mjs';
import {indexClose,clearIndexCache} from '../lib/indices.mjs';
import {reconcile} from '../lib/model.mjs';

test('manual cache reset fetches both fund and index data again',async()=>{
 const old=globalThis.fetch;let profiles=0,indices=0;
 globalThis.fetch=async url=>{
  if(url.includes('pingzhongdata')){profiles++;return {ok:true,text:async()=> 'var fS_name = "观察基金A";'};}
  indices++;return {ok:true,json:async()=>({data:{usNDX:{qt:{usNDX:['','','.NDX']},day:[['2026-09-28','1','100'],['2026-09-29','1',String(100+indices)]]}}})};
 };
 try{
  await fundProfile('123456');await fundProfile('123456');
  await indexClose('NDX','2026-09-29');await indexClose('NDX','2026-09-29');
  assert.equal(profiles,1);assert.equal(indices,1);
  await Promise.all([clearProviderCache(),clearIndexCache()]);
  await fundProfile('123456');const quote=await indexClose('NDX','2026-09-29');
  assert.equal(profiles,2);assert.equal(indices,2);assert.equal(quote.close,102);
 }finally{globalThis.fetch=old;await Promise.all([clearProviderCache(),clearIndexCache()]);}
});

test('recalculation preserves original forecast and published actual, failure preserves previous result',()=>{
 const first={model:{value:1.01,return:.01}},next={model:{value:1.02,return:.02}};
 const initial=reconcile(null,first,null,'first');
 const updated=reconcile(initial,next,null,'second');
 assert.equal(updated.forecast,next);assert.equal(updated.originalForecast,first);assert.equal(updated.firstForecastAt,'first');
 assert.equal(reconcile(updated,null,null,'failed').forecast,next);
 const actual={value:1.015,dailyReturn:.015};
 const published=reconcile(updated,first,actual,'published');
 assert.equal(published.actual,actual);assert.equal(published.forecast,next);assert.equal(published.originalForecast,first);
 assert.equal(reconcile(published,first,null,'regression'),published);
 assert.equal(reconcile(null,next,actual,'after-publication').forecast,null);
});
