import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {reportPeriod,matchAnnouncements,holdingsAnnouncements} from '../lib/holdings-announcements.mjs';

test('按报告所属年份匹配季度与半年年末，不把提示和摘要当作原文',()=>{
 for(const [title,date] of [
  ['基金2026年第1季度报告','2026-03-31'],['基金2026年第二季度报告','2026-06-30'],
  ['基金2026年第3季度报告','2026-09-30'],['基金2025年第四季度报告','2025-12-31'],
  ['基金2026年中期报告','2026-06-30'],['基金2026年半年度报告','2026-06-30'],['基金2025年年度报告','2025-12-31']
 ])assert.equal(reportPeriod(title),date);
 for(const title of ['旗下基金2026年第3季度报告提示性公告','基金2025年度报告摘要','基金分红公告'])assert.equal(reportPeriod(title),null);
 const entry={FUNDCODE:'123456',ID:'AN202610271234',TITLE:'测试2026年第3季度报告',PUBLISHDATE:'2026-10-27T00:00:00'};
 const matched=matchAnnouncements('123456',['2026-09-30','2026-06-30'],[entry,{...entry,FUNDCODE:'222222'},{...entry,ID:'bad"onclick='},{...entry,TITLE:'2026年第2季度报告'}]);
 assert.equal(matched.periods[0].reports.length,1);assert.equal(matched.periods[1].reports.length,1);
 assert.equal(matched.periods[0].reports[0].url,'https://fund.eastmoney.com/gonggao/123456,AN202610271234.html');
 assert.equal(matched.periods[0].reports[0].publishedAt,'2026-10-27');
 assert.equal(matchAnnouncements('123456',['2026-03-31'],[entry]).periods[0].reports.length,0);
});
test('同基金合并并发读取并缓存，失败后可重试，参数无效不请求上游',async()=>{
 let calls=0;
 const fetcher=async(url,options)=>{calls++;assert.match(url,/fundcode=111111.*type=3/);assert.ok(options.signal);return {ok:true,text:async()=>JSON.stringify({ErrCode:0,Data:[]})};};
 await Promise.all([holdingsAnnouncements('111111',['2026-09-30'],{fetcher}),holdingsAnnouncements('111111',['2026-06-30'],{fetcher})]);
 await holdingsAnnouncements('111111',['2026-03-31'],{fetcher});assert.equal(calls,1);
 await assert.rejects(holdingsAnnouncements('222222',['2026-09-30'],{fetcher:async()=>({ok:false,status:503})}),/503/);
 await assert.rejects(holdingsAnnouncements('222222',['2026-09-30'],{fetcher:async()=>({ok:true,text:async()=>'{"ErrCode":0,"Data":{}}'})}),/格式/);
 assert.equal((await holdingsAnnouncements('222222',['2026-09-30'],{fetcher:async()=>({ok:true,text:async()=>'{"ErrCode":0,"Data":[]}'})})).periods[0].reports.length,0);
 for(const [code,dates] of [['../',['2026-09-30']],['123456',[]],['123456',['2026-02-30']]])await assert.rejects(holdingsAnnouncements(code,dates,{fetcher}),/无效/);
 assert.equal(calls,1);
});
test('公告只读路由支持超过100天的旧披露期，拒绝无效日期并保留未匹配状态',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-announcements-'));
 process.env.PORT='0';process.env.QDII_STORAGE='json';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:[],records:{},lastView:{}}));
 const realFetch=globalThis.fetch;
 globalThis.fetch=async(input,options)=>{
  if(String(input).startsWith('http://127.0.0.1:'))return realFetch(input,options);
  assert.match(String(input),/\/f10\/JJGG\?fundcode=333333/);
  return {ok:true,text:async()=>JSON.stringify({ErrCode:0,Data:[{FUNDCODE:'333333',TITLE:'测试2025年年度报告',ID:'AN202603301234',PUBLISHDATE:'2026-03-30'}]})};
 };
 let app;
 try{
  app=await import('../server.mjs');if(!app.server.listening)await new Promise(resolve=>app.server.once('listening',resolve));
  const base='http://127.0.0.1:'+app.server.address().port;
  const r=await realFetch(base+'/api/holdings/announcements?code=333333&date=2025-12-31&previousDate=2025-06-30');
  assert.equal(r.status,200);const data=await r.json();assert.equal(data.periods[0].reports.length,1);assert.equal(data.periods[1].reports.length,0);
  assert.equal((await realFetch(base+'/api/holdings/announcements?code=333333&date=2026-02-30')).status,400);
  assert.equal((await realFetch(base+'/api/holdings/announcements?code=333333')).status,400);
 }finally{if(app)await app.shutdown();globalThis.fetch=realFetch;fs.rmSync(dir,{recursive:true,force:true});}
});
