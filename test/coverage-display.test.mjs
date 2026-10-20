import test from 'node:test';
import assert from 'node:assert/strict';
import {reliability,reliabilityPanel} from '../public/forecast-details.js';

test('reliability uses the displayed saved forecast rather than a newer diagnostic snapshot',()=>{
 const f={date:'2026-10-19',latestHoldings:{asOf:'2026-09-30'},quality:{coverage:66.7},
  record:{forecast:{holdingsDate:'2026-06-30',model:{coverage:79.53},rows:[]}},analysis:{model:{coverage:66.7}}};
 const original=structuredClone(f),r=reliability(f);
 assert.equal(r.coverage,79.53);assert.equal(r.holdingDate,'2026-06-30');
 const html=reliabilityPanel(f);assert.match(html,/79\.53%/);assert.doesNotMatch(html,/66\.7|2026-09-30/);
 assert.deepEqual(f,original,'display must preserve saved estimates');
});

test('partial and analysis estimates use their own coverage, including zero and missing values',()=>{
 for(const type of ['partial','analysis']){
  const forecast={holdingsDate:'2026-06-30',model:{coverage:0}};
  const f={date:'2026-10-19',quality:{coverage:90},record:type==='partial'?{partialForecast:forecast}:{},analysis:type==='analysis'?forecast:null};
  assert.equal(reliability(f).coverage,0);assert.ok(reliability(f).issues.includes('有效资产覆盖不足50%'));
  assert.match(reliabilityPanel(f),/0\.00%/);
 }
 const missing={quality:{coverage:66.7},analysis:{model:{}}};
 assert.equal(reliability(missing).coverage,undefined);assert.doesNotMatch(reliabilityPanel(missing),/66\.7/);
});
