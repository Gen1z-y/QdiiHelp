import test from 'node:test';
import assert from 'node:assert/strict';
import {gracefulLifecycle} from '../lib/graceful-lifecycle.mjs';

test('shutdown drains running work and newly chained saves before close, once',async()=>{
 let release, save, began=0, closed=0;
 const pending=new Set();
 const task=new Promise(resolve=>release=resolve).then(()=>{
  const next=new Promise(resolve=>save=resolve).finally(()=>pending.delete(next));
  pending.add(next);
 }).finally(()=>pending.delete(task));
 pending.add(task);
 const stop=gracefulLifecycle({begin(){began++;},pending:()=>[...pending],close:async()=>{closed++;}});
 const first=stop();assert.equal(first,stop());assert.equal(began,1);assert.equal(closed,0);
 release();await task;assert.equal(closed,0);save();await first;
 assert.equal(closed,1);
});

test('failed operations still drain, but failed persistence is reported',async()=>{
 let task=Promise.reject(Error('upstream failed'));task.catch(()=>{});
 const pending=new Set([task]);task.finally(()=>pending.delete(task)).catch(()=>{});
 const stop=gracefulLifecycle({begin(){},pending:()=>[...pending],close:async()=>{throw Error('save failed');}});
 await assert.rejects(stop(),/save failed/);
});
