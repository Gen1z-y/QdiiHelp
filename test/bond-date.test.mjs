import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {bondObservation} from '../lib/bond-date.mjs';
import {dateStatus} from '../public/forecast-details.js';

test('bond holidays and weekends use published dates; open and unknown days retain normal observation',()=>{
 for(const [today,latest] of [['2026-10-05','2026-09-30'],['2026-09-25','2026-09-24'],['2026-09-27','2026-09-24']]){
  const r=bondObservation(today,latest);assert.equal(r.date,latest);assert.ok(r.closure);
  assert.match(dateStatus({bond:true,date:latest,domesticClosure:r.closure}),/最近公布/);
  assert.doesNotMatch(dateStatus({bond:true,date:latest,domesticClosure:r.closure}),/等待数据/);
 }
 assert.equal(bondObservation('2026-10-05','2026-10-02').date,'2026-10-02','accept NAV actually published during closure');
 assert.match(dateStatus({bond:true,domesticClosure:bondObservation('2026-10-05','2026-10-05').closure}),/已获取新净值/);
 assert.deepEqual(bondObservation('2026-10-08','2026-09-30'),{date:'2026-10-08',closure:null});
 assert.equal(bondObservation('2027-10-05','2027-09-30').closure,null,'unknown calendar must not invent a holiday');
 assert.equal(bondObservation('2026-10-05',null).date,'2026-09-30');
 assert.match(dateStatus({bond:true,date:'2026-10-05',domesticClosure:bondObservation('2026-10-05','2026-09-30').closure},{automatic:false}),/手选日期/);
});

test('automatic homepage uses latest official bond NAV, manual date stays exact, startup creates no backup',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-bond-calendar-'));
 process.env.PORT='8798';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:['006337'],records:{},lastView:{}}));
 const RealDate=Date,realFetch=globalThis.fetch;let server,latest='2026-09-30';
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-05T04:00:00Z']));}static now(){return RealDate.parse('2026-10-05T04:00:00Z');}};
 globalThis.fetch=async input=>{
  const url=String(input);if(url.includes('pingzhongdata'))return {ok:true,text:async()=> 'var fS_name = "测试债券A";'};
  if(url.includes('lsjz')){const value={TotalCount:2,Data:{LSJZList:[{FSRQ:latest,DWJZ:'1.02',JZZZL:'0.05'},{FSRQ:'2026-09-29',DWJZ:'1.01',JZZZL:'0.01'}]}};return {ok:true,text:async()=>JSON.stringify(value),json:async()=>value};}
  throw Error('Unexpected upstream '+url);
 };
 const get=async suffix=>{const r=await realFetch('http://127.0.0.1:8798/api/funds?'+suffix);assert.equal(r.status,200);return (await r.json()).items[0];};
 try{
  ({server}=await import('../server.mjs'));if(!server.listening)await new Promise(r=>server.once('listening',r));
  const first=await get('date=auto');assert.equal(first.date,'2026-09-30');assert.equal(first.record.actual.date,'2026-09-30');assert.equal(first.record.actual.dailyReturn,.0005);assert.equal(first.record.forecast,null);
  assert.equal(first.domesticClosure.today,'2026-10-05');
  const cached=await get('date=auto&cached=1');assert.equal(cached.date,'2026-09-30');assert.equal(cached.domesticClosure.publishedDate,'2026-09-30');
  const manual=await get('date=2026-10-05');assert.equal(manual.date,'2026-10-05');assert.equal(manual.record.actual,null);assert.equal(manual.domesticClosure,undefined);
  latest='2026-10-02';const revised=await get('date=auto');assert.equal(revised.date,latest);assert.equal(revised.record.actual.date,latest);
  assert.equal(fs.existsSync(process.env.QDII_DATA_FILE+'.backups'),false);
 }finally{if(server)await new Promise(r=>server.close(r));globalThis.fetch=realFetch;globalThis.Date=RealDate;}
});
