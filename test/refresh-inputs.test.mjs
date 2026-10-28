import test from 'node:test';import assert from 'node:assert/strict';
import {RefreshInputs} from '../lib/refresh-inputs.mjs';
test('a refresh shares profile failures as well as successes, and a new round can retry',async()=>{
 const inputs=new RefreshInputs();let calls=0;const fail=()=>{calls++;throw Error('source failed');};
 await assert.rejects(inputs.profile('A',fail),/source failed/);
 await assert.rejects(inputs.profile('A',fail),/source failed/);assert.equal(calls,1);
 const next=new RefreshInputs();assert.equal(await next.profile('A',()=>{calls++;return 'recovered';}),'recovered');assert.equal(calls,2);
});
