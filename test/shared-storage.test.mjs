import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../lib/store.mjs';import {loadState,archiveDir,digest} from '../lib/storage-format.mjs';
import {compactArchives} from '../lib/storage-maintenance.mjs';
test('row quotes inline per forecast; restart and compaction retain dependencies',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-shared-')),file=path.join(dir,'state.json');
 try{
  const store=new Store(file),fx={base:{date:'2026-09-30',close:7},target:{date:'2026-10-08',close:7.1},return:.014};
  const make=(weight,time)=>({date:'2026-10-08',calculatedAt:time,rows:[{code:'A',weight,stock:{base:{date:'2026-09-30',close:100},target:{date:'2026-10-08',close:105},return:.05},fx:structuredClone(fx)}]});
  store.data.records={'111111:2026-10-08':{forecast:make(10,'a')},'222222:2026-10-08':{forecast:make(20,'b')}};store.save();
  const original=structuredClone(store.data),raw=JSON.parse(fs.readFileSync(file));assert.equal(raw.storageVersion,3);
  const restored=loadState(file);assert.deepEqual(restored,original);
  assert.deepEqual(restored.records['111111:2026-10-08'].forecast.rows[0].fx,restored.records['222222:2026-10-08'].forecast.rows[0].fx);
  const reopened=new Store(file),size=()=>fs.readdirSync(archiveDir(file)).reduce((n,f)=>n+fs.statSync(path.join(archiveDir(file),f)).size,0),before=size();
  reopened.save();assert.equal(size(),before);compactArchives(file,{force:true});assert.deepEqual(loadState(file),original);
  const migrated=new Store(file);migrated.data.records['333333:2026-10-09']={forecast:make(30,'c')};migrated.save();assert.deepEqual(loadState(file),migrated.data);
 }finally{if(path.dirname(path.resolve(dir))===path.resolve(os.tmpdir())&&path.basename(dir).startsWith('qdii-shared-'))fs.rmSync(dir,{recursive:true,force:true});}
});
test('version 2 remains readable and migrates on save',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-shared-')),file=path.join(dir,'state.json');
 try{
  const forecast={date:'2026-10-08',model:{return:.1},rows:[{stock:{base:{date:'2026-09-30',close:100},target:{date:'2026-10-08',close:110}}}]},bytes=Buffer.from(JSON.stringify(forecast)),id=digest(bytes);
  fs.mkdirSync(archiveDir(file));fs.writeFileSync(path.join(archiveDir(file),'2026-10.ndjson'),bytes);
  fs.writeFileSync(file,JSON.stringify({version:1,storageVersion:2,watchlist:['111111'],fundGroups:{},records:{'111111:2026-10-08':{forecast:{$archive:id}}},lastView:{},archives:{[id]:{file:'2026-10.ndjson',offset:0,length:bytes.length}}}));
  const before=loadState(file),store=new Store(file);store.save();assert.equal(JSON.parse(fs.readFileSync(file)).storageVersion,3);assert.deepEqual(loadState(file),before);
 }finally{if(path.dirname(path.resolve(dir))===path.resolve(os.tmpdir())&&path.basename(dir).startsWith('qdii-shared-'))fs.rmSync(dir,{recursive:true,force:true});}
});
