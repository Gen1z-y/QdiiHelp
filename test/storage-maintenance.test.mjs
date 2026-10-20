import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {Store} from '../lib/store.mjs';
import {loadState,archiveDir} from '../lib/storage-format.mjs';
import {compactArchives,compressMigrationBackup,rotateLog} from '../lib/storage-maintenance.mjs';
import {configureQuoteCache,writeQuoteCache,readQuoteCache,pruneQuoteCache} from '../lib/quote-cache.mjs';
function fixture(){
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'qdii-maintenance-')),'state.json');
 fs.writeFileSync(file,JSON.stringify({version:1,watchlist:['006373'],records:{},lastView:{}}));
 const store=new Store(file);
 for(let i=0;i<3;i++){store.data.records['006373:2026-10-01']={forecast:{date:'2026-10-01',model:{dailyReturn:i},rows:Array(500).fill('payload')}};store.save();}
 return {file,store};
}
test('compaction preserves complete data, supports later appends, restart and repeat compaction',()=>{
 const {file,store}=fixture(),before=loadState(file);
 const result=store.compact({force:true});assert.ok(result.saved>0);assert.deepEqual(loadState(file),before);
 // Refresh a live Store's cached offsets after an exclusive maintenance pass.
 store.compact();store.data.records['006373:2026-10-02']={forecast:{date:'2026-10-02',model:{dailyReturn:.2}}};store.save();
 assert.deepEqual(loadState(file),store.data);const reopened=new Store(file);reopened.save();assert.deepEqual(loadState(file),store.data);
 compactArchives(file,{force:true});assert.deepEqual(loadState(file),store.data);
});
test('failed precommit retains old manifest and data, removes staged generation',()=>{
 const {file}=fixture(),manifest=fs.readFileSync(file),before=loadState(file),names=fs.readdirSync(archiveDir(file));
 assert.throws(()=>compactArchives(file,{force:true,beforeCommit(){throw Error('simulated failure');}}),/simulated/);
 assert.deepEqual(fs.readFileSync(file),manifest);assert.deepEqual(loadState(file),before);assert.deepEqual(fs.readdirSync(archiveDir(file)),names);
});
test('corrupt archive is never committed or discarded by compaction',()=>{
 const {file}=fixture(),manifest=fs.readFileSync(file),ref=Object.values(JSON.parse(manifest).archives)[0];
 const fd=fs.openSync(path.join(archiveDir(file),ref.file),'r+');fs.writeSync(fd,Buffer.from('!'),0,1,ref.offset);fs.closeSync(fd);
 assert.throws(()=>compactArchives(file,{force:true}),/校验/);assert.deepEqual(fs.readFileSync(file),manifest);
});
test('migration compression verifies bytes and log rotation retains three generations',()=>{
 const {file}=fixture(),bytes=fs.readFileSync(file+'.before-monthly-storage.bak');
 compressMigrationBackup(file);assert.deepEqual(gunzipSync(fs.readFileSync(file+'.before-monthly-storage.bak.gz')),bytes);assert.ok(!fs.existsSync(file+'.before-monthly-storage.bak'));assert.equal(compressMigrationBackup(file).saved,0);
 const log=file+'.log';for(let i=0;i<5;i++){fs.writeFileSync(log,String(i).repeat(20));rotateLog(log,10,3);}
 assert.equal(fs.readFileSync(log+'.1','utf8'),'4'.repeat(20));assert.ok(fs.existsSync(log+'.3'));assert.ok(!fs.existsSync(log+'.4'));
});
test('cache removes expired and oldest over-budget entries without deleting unrelated files',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-cache-limit-'));configureQuoteCache(dir);
 fs.writeFileSync(path.join(dir,'keep.txt'),'keep');writeQuoteCache('old','x'.repeat(100),Date.now()-100000);assert.equal(readQuoteCache('old',10),null);
 writeQuoteCache('first','x'.repeat(100));writeQuoteCache('second','y'.repeat(100));const result=pruneQuoteCache({maxBytes:200});assert.ok(result.bytes<=200);assert.equal(result.removed,1);assert.ok(fs.existsSync(path.join(dir,'keep.txt')));
 const entry=fs.readdirSync(dir).find(f=>f.endsWith('.json'));fs.utimesSync(path.join(dir,entry),new Date(0),new Date(0));assert.equal(pruneQuoteCache().bytes,0);
 configureQuoteCache(null);
});
