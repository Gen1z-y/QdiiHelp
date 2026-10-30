import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parseOfficialFixings,officialFxSummary,isOfficialFx,OFFICIAL_FX_URL} from '../lib/official-fx.mjs';
import {configureQuoteCache,writeQuoteCache} from '../lib/quote-cache.mjs';
const payload=(rows=[['2026-10-29','6.7147'],['2026-10-28','6.7165']])=>({head:{rep_code:'200'},data:{currency:'USD/CNY'},records:rows.map(([date,value])=>({date,values:[value]}))});
test('官方数据按上一公布日计算涨跌，排除T+1数据',()=>{
 const r=parseOfficialFixings(payload([['2026-10-30','6.7138'],['2026-10-28','6.7165'],['2026-10-29','6.7147']]),'2026-10-29');
 assert.equal(r.close,6.7147);assert.equal(r.previousDate,'2026-10-28');assert.equal(r.dailyReturn,6.7147/6.7165-1);assert.equal(r.carried,false);assert.equal(isOfficialFx(r),true);
});
test('休市沿用实际公布日期和该公布日涨幅，不伪造零涨幅',()=>{
 const r=parseOfficialFixings(payload([['2026-10-09','6.7330'],['2026-10-08','6.7367']]),'2026-10-11');
 assert.equal(r.carried,true);assert.equal(r.closeDate,'2026-10-09');assert.equal(r.dailyReturn,6.7330/6.7367-1);
});
test('拒绝错误币种、错误响应、畸形或缺失数值、冲突日期及过期记录',()=>{
 for(const p of [{...payload(),data:{currency:'CNY/USD'}},{...payload(),head:{rep_code:'500'}},payload([['2026-10-29','0'],['2026-10-28','6.7']]),payload([['2026-10-29',null],['2026-10-28','6.7']]),payload([['2026-10-29','6.7'],['2026-10-29','6.8'],['2026-10-28','6.9']]),payload([['2026-09-29','6.7'],['2026-09-28','6.8']]),payload([['2026-10-29','6.7']])])assert.throws(()=>parseOfficialFixings(p,'2026-10-29'));
 assert.throws(()=>parseOfficialFixings(payload(),'2026-02-30'));assert.equal(isOfficialFx({authority:'CFETS',sourceUrl:OFFICIAL_FX_URL,close:6.7}),false);
});
test('只访问官方接口，限定币种日期和超时；缓存必须来自官方',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-official-fx-test-'));configureQuoteCache(dir);let calls=0;
 try{
  const fetcher=async(url,options)=>{calls++;const u=new URL(url);assert.equal(u.host,'www.chinamoney.com.cn');assert.equal(u.pathname,'/ags/ms/cm-u-bk-ccpr/CcprHisNew');assert.equal(u.searchParams.get('currency'),'USD/CNY');assert.equal(u.searchParams.get('endDate'),'2026-10-29');assert.equal(options.headers.Referer,OFFICIAL_FX_URL);assert.ok(options.signal);return {ok:true,text:async()=>JSON.stringify(payload())};};
  const first=await officialFxSummary('2026-10-29',{fetcher});assert.equal(isOfficialFx(first),true);assert.deepEqual(await officialFxSummary('2026-10-29',{fetcher}),first);assert.equal(calls,1);
  writeQuoteCache('official-usdcny-v1:2026-10-29',{...first,authority:undefined,source:'Frankfurter'});await officialFxSummary('2026-10-29',{fetcher});assert.equal(calls,2);
 }finally{configureQuoteCache(null);assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true,force:true});}
});
test('官方接口失败时不启用第三方回退，错误不能作为成功记录',async()=>{
 configureQuoteCache(null);let calls=0;
 await assert.rejects(officialFxSummary('2026-10-29',{fetcher:async()=>{calls++;return {ok:false,status:503};}}),/HTTP 503/);assert.equal(calls,1);
 await assert.rejects(officialFxSummary('2026-10-29',{fetcher:async()=>({ok:true,text:async()=>'<html>error</html>'})}));await assert.rejects(officialFxSummary('2026-02-30'),/日期无效/);
});
