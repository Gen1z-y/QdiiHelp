import test from 'node:test';import assert from 'node:assert/strict';
import {validateCalibration,forecastStats} from '../lib/forecast-stats.mjs';
import {calendarCoverage} from '../lib/calendar-maintenance.mjs';
import {session} from '../lib/calendar.mjs';
import {reliability,reliabilityPanel} from '../public/forecast-details.js';
import {refreshReport} from '../public/request.js';
test('walk-forward calibration never trains on future actual observations and compares identical evaluation dates',()=>{
 const samples=Array.from({length:25},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),forecast:.02,actual:.01,error:1,calculatedAt:i*86400000,actualSeenAt:(i+.5)*86400000}));
 const v=validateCalibration(samples);assert.equal(v.count,15);assert.equal(v.rawMae,1);assert.equal(v.correctedMae,0);assert.equal(v.evaluations[0].trainingCount,10);assert.equal(v.recentCount,10);assert.equal(v.previousCount,10);
 const delayed=validateCalibration(samples.map(s=>({...s,actualSeenAt:1e15})));assert.equal(delayed.count,0);assert.equal(delayed.correctedMae,null);
 const frozen=structuredClone(samples);validateCalibration(samples);assert.deepEqual(samples,frozen);
});
test('reliability distinguishes bond/index models, catches stale FX and escapes messages',()=>{
 const f={code:'123456',date:'2026-10-14',latestHoldings:{asOf:'2026-06-30'},quality:{coverage:40},analysis:{rows:[{fx:{target:{date:'2026-10-13'}}}]},error:'<script>'};
 assert.ok(reliability(f).attention);assert.ok(reliability(f).issues.some(x=>x.includes('汇率')));assert.doesNotMatch(reliabilityPanel(f),/<script>/);
 assert.equal(reliability({bond:true,record:{actual:{}}}).attention,false);assert.equal(reliability({index:true,record:{actual:{}}}).attention,false);
});
test('calendar maintenance warns ahead of rollover and preserves unverified Korean coverage',()=>{
 const coverage=calendarCoverage('2026-10-15');assert.match(coverage.find(c=>c.market==='CN').warning,/跨年/);assert.equal(coverage.find(c=>c.market==='US').warning,null);assert.equal(coverage.find(c=>c.market==='KR').covered,false);
 assert.equal(calendarCoverage('2028-01-03').find(c=>c.market==='CN').covered,false);
 assert.equal(session('2028-01-03','US').closed,false);assert.equal(session('2028-07-03','US').closeHour,13);assert.equal(session('2028-11-23','US').closed,true);
});
test('refresh report presentation exposes partial failures without leaking unsafe HTML',()=>{
 const html=refreshReport({id:'id',status:'partial',counts:{total:2,failed:1},items:[{code:'123456',name:'<img>',status:'cached',error:'timeout'}]});assert.match(html,/只重试失败的 1 只/);assert.doesNotMatch(html,/<img>/);
});
