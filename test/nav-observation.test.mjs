import test from 'node:test';
import assert from 'node:assert/strict';
import {navObservation,navEstimate,navSnapshot} from '../lib/nav-observation.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('publication dates skip domestic holidays and weekend make-up workdays',()=>{
 assert.equal(navObservation('2026-10-08'),'2026-10-08');
 assert.equal(navObservation('2026-10-09'),'2026-10-08');
 assert.equal(navObservation('2026-10-10'),'2026-10-09');
 assert.equal(navObservation('2026-10-11'),'2026-10-09');
 assert.equal(navObservation('2026-10-12'),'2026-10-09');
 assert.equal(navObservation('2026-10-07'),'2026-10-08');
});
test('NAV-day forecast includes holiday returns, and rejects stale bases and mismatched dates',()=>{
 const f={date:'2026-10-08',record:{forecast:{date:'2026-10-08',base:{date:'2026-09-30'},model:{return:.08,dailyReturn:.01}}}};
 assert.equal(navEstimate(f).return,.08);
 assert.equal(navEstimate({...f,date:'2026-09-30'}).return,null);
 f.record.forecast.base.date='2026-09-29';assert.equal(navEstimate(f).return,null);
 f.record.actual={previousDate:'2026-09-29'};assert.equal(navEstimate(f).return,.08);
});
test('cache fallback keeps the target date without reusing another date forecast',()=>{
 const saved={date:'2026-10-07',record:{forecast:{model:{return:.07}}},indexQuote:{date:'2026-10-07'},analysis:{model:{return:.07}}};
 const result=navSnapshot(saved,'2026-09-30');assert.equal(result.date,'2026-09-30');assert.deepEqual(result.record,{});assert.equal(result.analysis,null);assert.equal(result.indexQuote,null);assert.equal(saved.date,'2026-10-07');
});
test('cached auto API targets October 8 without relabelling a stale September forecast',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-nav-observation-'));process.env.PORT='8802';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 const forecast={date:'2026-09-30',base:{date:'2026-09-29',value:1},model:{return:.02,dailyReturn:.003,value:1.02},holdingsDate:'2026-06-30',rows:[{weight:100,rmbReturn:.02,currency:'CNY',stock:{base:{date:'2026-09-29'},target:{date:'2026-09-30'}}}]};
 const records={'123456:2026-09-30':{forecast,actual:{date:'2026-09-30',previousDate:'2026-09-29',dailyReturn:.018}}};
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:['123456'],records,lastView:{'123456:2026-10-07':{code:'123456',name:'测试全球股票',date:'2026-10-07',checkedAt:'2026-10-08T01:00:00Z',record:{forecast:{model:{return:.99}}}}}}));
 const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-08T10:00:00Z']));}static now(){return RealDate.parse('2026-10-08T10:00:00Z');}};
 let server;try{({server}=await import('../server.mjs'));if(!server.listening)await new Promise(r=>server.once('listening',r));const r=await fetch('http://127.0.0.1:8802/api/funds?date=auto&cached=1');assert.equal(r.status,200);const {items}=await r.json();assert.equal(items[0].date,'2026-10-08');assert.equal(items[0].record.actual,undefined);assert.equal(items[0].navEstimate.return,null);assert.equal(items[0].recentObservations[0].date,'2026-09-30');assert.equal(items[0].recentObservations[0].actual,.018);assert.equal(items[0].cumulativeWindow,undefined);}
 finally{if(server)await new Promise(r=>server.close(r));globalThis.Date=RealDate;}
});
