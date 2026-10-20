import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedUpdate} from '../lib/update-task.mjs';
import {mapLimit} from '../lib/provider.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('joining an existing background update replays and forwards its progress',async()=>{
 const tasks=new Map(),gate=deferred(),a=[],b=[];let runs=0;
 const first=sharedUpdate(tasks,'fund',s=>a.push(s),async({report})=>{runs++;report('stocks');await gate.promise;report('valuation');return 42;});
 await Promise.resolve();
 const second=sharedUpdate(tasks,'fund',s=>b.push(s),()=>{throw Error('duplicate work');});
 assert.deepEqual(b,['stocks']);gate.resolve();
 assert.deepEqual(await Promise.all([first,second]),[42,42]);
 assert.equal(runs,1);assert.deepEqual(b,['stocks','valuation']);assert.equal(tasks.size,0);
});
test('hung tasks time out and free both queue slots for later funds',async()=>{
 const tasks=new Map();
 const results=await mapLimit([1,2,3],n=>sharedUpdate(tasks,String(n),()=>{},async({report})=>{report('prices');if(n<3)return new Promise(()=>{});return n;},{timeoutMs:20}).catch(e=>e.message),2);
 assert.match(results[0],/超时.*prices/);assert.match(results[1],/超时/);assert.equal(results[2],3);assert.equal(tasks.size,0);
});
test('expired work cannot commit or emit late progress or remove its replacement',async()=>{
 const tasks=new Map(),oldGate=deferred(),newGate=deferred(),stages=[];let commits=0;
 const old=sharedUpdate(tasks,'fund',s=>stages.push(s),async({report,check})=>{report('slow');await oldGate.promise;check();commits++;return 1;},{timeoutMs:20});
 await assert.rejects(old,/超时/);
 const fresh=sharedUpdate(tasks,'fund',()=>{},async()=>{await newGate.promise;return 2;});
 oldGate.resolve();await new Promise(r=>setTimeout(r,5));
 assert.equal(commits,0);assert.equal(tasks.size,1);assert.deepEqual(stages,['正在开始更新','slow']);
 newGate.resolve();assert.equal(await fresh,2);assert.equal(tasks.size,0);
});
test('failed task releases its slot and can be retried',async()=>{
 const tasks=new Map();await assert.rejects(sharedUpdate(tasks,'x',()=>{},()=>{throw Error('source failed');}),/source failed/);
 assert.equal(tasks.size,0);assert.equal(await sharedUpdate(tasks,'x',()=>{},()=>7),7);
});
