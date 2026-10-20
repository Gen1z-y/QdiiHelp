import test from 'node:test';
import assert from 'node:assert/strict';
import {buildComparison,fetchHistory} from '../lib/history.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('增量合并覆盖修订、跨页补缺、去重并保留完整历史',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-incremental-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'data','history');fs.mkdirSync(dir,{recursive:true});
 const date=days=>{const d=new Date();d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);};
 const file=path.join(dir,'000001.json'),stamp=new Date(Date.now()-7200000).toISOString();
 const old={schema:2,historyComplete:true,code:'000001',fetchedAt:stamp,rows:Array.from({length:420},(_,i)=>({date:date(i+25),value:1,dailyReturn:0}))};
 fs.writeFileSync(file,JSON.stringify(old));let calls=0;
 const fetcher=async url=>{calls++;const page=Number(new URL(url).searchParams.get('pageIndex'));return {ok:true,json:async()=>({TotalCount:500,Data:{LSJZList:Array.from({length:20},(_,i)=>({FSRQ:date((page-1)*20+i),DWJZ:'2',JZZZL:'1'}))}})};};
 const result=await fetchHistory('000001',root,{fetcher});
 assert.equal(calls,2);assert.equal(result.rows.length,445);
 assert.equal(result.rows[0].date,date(0));assert.equal(result.rows.at(-1).date,date(444));
 assert.equal(result.rows.find(r=>r.date===date(25)).value,2);
 assert.equal(result.rows.find(r=>r.date===date(40)).value,1);
 assert.equal(new Set(result.rows.map(r=>r.date)).size,result.rows.length);
 assert.equal(result.fullFetchedAt,stamp);
 await fetchHistory('000001',root,{fetcher});assert.equal(calls,2);
 assert.deepEqual(fs.readdirSync(dir),['000001.json']);
});

test('强制或每周校验重取全量，失败保留磁盘数据',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-history-refresh-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'data','history');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'000001.json');
 const records=Array.from({length:25},(_,i)=>{const d=new Date();d.setUTCDate(d.getUTCDate()-i);return {FSRQ:d.toISOString().slice(0,10),DWJZ:'3',JZZZL:'0'};});
 for(const force of [false,true]){
  const old={schema:2,fetchedAt:new Date(Date.now()-7200000).toISOString(),fullFetchedAt:new Date(Date.now()-(force?1:8)*86400000).toISOString(),rows:records.map(r=>({date:r.FSRQ,value:1}))};
  fs.writeFileSync(file,JSON.stringify(old));let calls=0;
  const fetcher=async url=>{calls++;const p=Number(new URL(url).searchParams.get('pageIndex'));return {ok:true,json:async()=>({TotalCount:25,Data:{LSJZList:records.slice((p-1)*20,p*20)}})};};
  const result=await fetchHistory('000001',root,{force,fetcher});
  assert.equal(calls,2);assert.equal(result.rows.at(-1).value,3);assert.notEqual(result.fullFetchedAt,old.fullFetchedAt);
 }
 const before=fs.readFileSync(file,'utf8');
 const failed=await fetchHistory('000001',root,{force:true,fetcher:async()=>{throw Error('offline');}});
 assert.equal(failed.stale,true);assert.match(failed.error,/offline/);assert.equal(fs.readFileSync(file,'utf8'),before);
});
test('累计收益包含独有交易日，不把起始日涨幅再次计入',()=>{
  const r=buildComparison([{code:'a',rows:[{date:'2026-09-01',value:1,dailyReturn:.5},{date:'2026-09-02',value:1.1,dailyReturn:.1},{date:'2026-09-03',value:.99,dailyReturn:-.1}]},{code:'b',rows:[{date:'2026-09-01',value:2,dailyReturn:.2},{date:'2026-09-03',value:2.2,dailyReturn:.1}]}],30,new Date('2026-09-20'));
  assert.deepEqual(r.dates,['2026-09-01','2026-09-03']);assert.equal(r.series[0].points[0].cumulative,0);
  assert.ok(Math.abs(r.series[0].totalReturn+.01)<1e-12);assert.ok(Math.abs(r.series[0].maxDrawdown+.1)<1e-12);
});
test('分红场景采用公布涨跌而非单位净值比值',()=>{
  const r=buildComparison([{code:'a',rows:[{date:'2026-09-01',value:2,dailyReturn:0},{date:'2026-09-02',value:1.5,dailyReturn:.01}]}],30,new Date('2026-09-20'));
  assert.ok(Math.abs(r.series[0].totalReturn-.01)<1e-12);
});
test('缺少日涨幅时拒绝生成虚假的平线',()=>{
  assert.throws(()=>buildComparison([{code:'a',rows:[{date:'2026-09-01',value:1,dailyReturn:0},{date:'2026-09-02',value:1,dailyReturn:null}]}],30,new Date('2026-09-20')),/缺少/);
});
test('单位与累计净值可补算缺失涨幅和现金分红',()=>{
  const r=buildComparison([{code:'a',rows:[{date:'2026-09-01',value:2,cumulativeNav:2,dailyReturn:0},{date:'2026-09-02',value:1.8,cumulativeNav:2.1,dailyReturn:null}]}],30,new Date('2026-09-20'));
  assert.ok(Math.abs(r.series[0].totalReturn-.05)<1e-12);assert.deepEqual(r.series[0].derivedDates,['2026-09-02']);
});
test('接口只给20条也继续分页并写入历史文件',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-history-'));let calls=0;
  const today=new Date();const records=Array.from({length:25},(_,i)=>{const d=new Date(today);d.setUTCDate(d.getUTCDate()-i);return {FSRQ:d.toISOString().slice(0,10),DWJZ:'2',JZZZL:'0.1'};});
  const fetcher=async url=>{calls++;const p=Number(new URL(url).searchParams.get('pageIndex'));return {ok:true,json:async()=>({TotalCount:25,Data:{LSJZList:records.slice((p-1)*20,p*20)}})};};
  const r=await fetchHistory('000001',root,{fetcher});assert.equal(calls,2);assert.equal(r.rows.length,25);
  const cached=await fetchHistory('000001',root,{fetcher});assert.equal(calls,2);assert.equal(cached.rows.length,25);
  fs.rmSync(path.join(root,'data','history','000001.json'));fs.rmdirSync(path.join(root,'data','history'));fs.rmdirSync(path.join(root,'data'));fs.rmdirSync(root);
});
