import test from 'node:test';
import assert from 'node:assert/strict';
import {RefreshTasks} from '../lib/refresh-tasks.mjs';
test('matching tray/page refreshes share work, continue without listener, persist partial results and retry only failures',async()=>{
 let release,calls=0;const gate=new Promise(r=>release=r),saved=[],inputs=[];
 const runs=[];const manager=new RefreshTasks({runs,persist:async()=>saved.push(JSON.parse(JSON.stringify(runs))),work:async(options,progress)=>{
  inputs.push(options);calls++;if(calls===1)await gate;progress({completed:1,total:2});
  return {items:calls===1?[{code:'111111',name:'A',navEstimate:{return:.01},record:{}},{code:'222222',name:'B',error:'网络失败',stale:true,record:{}}]:[{code:'222222',name:'B',navEstimate:{return:.02},record:{}}]};
 }});
 const first=manager.start({source:'tray'}),duplicate=manager.start({source:'page'},()=>{throw Error('disconnected');});
 assert.equal(first,duplicate);assert.equal(manager.pending().length,1);release();await first.promise;
 assert.equal(calls,1);assert.equal(runs[0].status,'partial');assert.equal(runs[0].counts.failed,1);assert.equal(runs[0].items[1].status,'cached');
 const retry=manager.retry(first.report.id);await retry.promise;assert.deepEqual(inputs[1].codes,['222222']);assert.equal(retry.report.status,'complete');assert.equal(manager.pending().length,0);assert.ok(saved.some(s=>s[0].status==='running'));assert.equal(saved.at(-1)[0].status,'complete');
});
test('failed persistence cannot report success; interrupted tasks survive restart and reports stay bounded',async()=>{
 let persist=0;const manager=new RefreshTasks({runs:[],work:async()=>({items:[]}),persist:async()=>{if(++persist>1)throw Error('保存失败');}});
 await assert.rejects(manager.start().promise,/保存失败/);assert.equal(manager.list()[0].status,'failed');
 const runs=[{id:'old',status:'running'}];const restarted=new RefreshTasks({runs,work:async()=>({items:[]})});assert.equal(runs[0].status,'interrupted');
 for(let i=0;i<25;i++)await restarted.start().promise;assert.equal(runs.length,20);
 const restored=[{id:'restore',status:'running'}];restarted.reset(restored);assert.equal(restarted.list(),restored);assert.equal(restored[0].status,'interrupted');
});
