import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSinaQuote,parseTencentQuote,quoteTimestamp,scheduledClose} from '../lib/global-markets.mjs';
import {forecastChart} from '../public/forecast-chart.js';

test('Sina uses dated Beijing fields, never old auxiliary timestamps',()=>{
 const latest=parseSinaQuote('var hq_str_b_DAX="德国DAX指数,25231.20,291.85,1.17,9/26/2025,2025-09-26,2026-10-02,23:30:00";',{id:'DAX'});
 assert.equal(latest.date,'2026-10-02');assert.equal(latest.asOf,'2026-10-02T15:30:00.000Z');
 assert.throws(()=>parseSinaQuote('var hq_str_b_DAX="DAX,10,1,1,16:00,16:00";',{id:'DAX'}),/日期/);
 assert.equal(parseSinaQuote('var hq_str_b_NKY="日经,68309.24,-647.48,-0.94,,,2026-10-02,14:30:02";',{id:'N225'}).asOf,'2026-10-02T06:30:02.000Z');
});
test('US source timestamp crosses Beijing date and applies daylight saving',()=>{
 const fields=Array(31).fill('');fields[2]='.INX';fields[3]='7722.72';fields[4]='7666.45';fields[30]='2026-10-02 16:59:13';
 const latest=parseTencentQuote('v_usINX="'+fields.join('~')+'";',{symbol:'usINX'});
 assert.equal(latest.date,'2026-10-02');assert.equal(latest.asOf,'2026-10-02T20:59:13.000Z');
 assert.equal(quoteTimestamp('2026-12-01 16:00:00','America/New_York'),'2026-12-01T21:00:00.000Z');
 assert.equal(quoteTimestamp('20260930161500','Asia/Shanghai'),'2026-09-30T08:15:00.000Z');
 assert.throws(()=>quoteTimestamp('16:00:00','Asia/Shanghai'),/时间/);
});
test('scheduled close distinguishes exchange day, daylight saving and early close',()=>{
 assert.equal(scheduledClose('NDX','2026-10-02').at,'2026-10-02T20:00:00.000Z');
 assert.equal(scheduledClose('DJI','2026-10-02').at,'2026-10-02T20:00:00.000Z');
 assert.equal(scheduledClose('DJI','2026-11-27').at,'2026-11-27T18:00:00.000Z');
 assert.equal(scheduledClose('FTSE','2026-12-01').at,'2026-12-01T16:35:00.000Z');
 assert.equal(scheduledClose('N225','2026-10-02').at,'2026-10-02T06:30:00.000Z');
 assert.equal(scheduledClose('DAX',null),null);
});

test('Nasdaq 100 quotes validate their own identity rather than the composite',()=>{
 const fields=Array(31).fill('');fields[2]='.NDX';fields[3]='25000';fields[4]='24500';fields[30]='2026-10-06 16:00:00';
 const raw='v_usNDX="'+fields.join('~')+'";';
 assert.equal(parseTencentQuote(raw,{symbol:'usNDX'}).close,25000);
 assert.throws(()=>parseTencentQuote(raw.replace('.NDX','.IXIC'),{symbol:'usNDX'}),/不匹配/);
});
test('every finite plotted point has a visible number including zero',()=>{
 const chart=forecastChart([{date:'2026-10-01',forecast:0,actual:.01},{date:'2026-10-02',forecast:-.005,actual:null}]);
 assert.equal((chart.match(/class="pointValue"/g)??[]).length,3);
 assert.match(chart,/>0.00%<\/text>/);assert.match(chart,/>-0.50%<\/text>/);
 assert.doesNotMatch(chart,/指向数据点可查看数值/);
});
