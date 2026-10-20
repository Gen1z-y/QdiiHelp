import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {Backups} from '../lib/backups.mjs';
import {archiveDir,loadState} from '../lib/storage-format.mjs';

function fixture(){
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'qdii-storage-')),'state.json');
 const rows=Array.from({length:200},(_,i)=>({code:String(i),weight:.1,source:'test',values:Array(40).fill(1.234)}));
 const data={version:1,watchlist:['123456'],positions:{'123456':{amount:10,profit:1}},records:{},lastView:{}};
 for(const date of ['2026-09-30','2026-10-01']){
  const forecast={date,model:{dailyReturn:.01},rows};
  data.records['123456:'+date]={forecast,originalForecast:forecast,evidence:[{date,rows}],actual:null};
  data.lastView['123456:'+date]={code:'123456',date,record:data.records['123456:'+date],analysis:forecast};
 }
 fs.writeFileSync(file,JSON.stringify(data));return {file,data};
}
test('monthly snapshots preserve full records, deduplicate, append only changes and reject corruption',()=>{
 const {file,data}=fixture(),legacy=fs.readFileSync(file),s=new Store(file);
 s.save();assert.deepEqual(fs.readFileSync(file+'.before-monthly-storage.bak'),legacy);
 assert.ok(fs.statSync(file).size<legacy.length/10);
 assert.deepEqual(fs.readdirSync(archiveDir(file)),['2026-09.ndjson','2026-10.ndjson']);
 assert.deepEqual(loadState(file).records,data.records);
 const sizes=()=>fs.readdirSync(archiveDir(file)).map(n=>fs.statSync(path.join(archiveDir(file),n)).size);
 const before=sizes();s.data.positions['123456'].amount=20;s.save();assert.deepEqual(sizes(),before);
 assert.throws(()=>{s.data.records['123456:2026-09-30'].forecast.rows[0].weight=30;},TypeError,'archived inputs cannot be silently edited in place');
 const r=s.data.records['123456:2026-10-01'];r.evidence.push({date:'2026-10-01',rows:[{weight:2}]});
 r.forecast={...r.forecast,model:{dailyReturn:.02}};s.save();
 assert.equal(sizes()[0],before[0]);assert.ok(sizes()[1]>before[1]);
 const restart=new Store(file);assert.equal(restart.data.positions['123456'].amount,20);assert.equal(restart.data.records['123456:2026-10-01'].forecast.model.dailyReturn,.02);assert.equal(restart.data.records['123456:2026-10-01'].evidence.length,2);
 const disk=JSON.parse(fs.readFileSync(file)),ref=Object.values(disk.archives)[0];
 const archive=path.join(archiveDir(file),ref.file),fd=fs.openSync(archive,'r+');fs.writeSync(fd,Buffer.from('!'),0,1,ref.offset);fs.closeSync(fd);
 assert.throws(()=>new Store(file),/校验失败/);
});
test('compressed backups are self contained, survive later saves and restore all evidence',async()=>{
 const {file}=fixture(),store=new Store(file),backups=new Backups(store);store.save();
 const expected=structuredClone(store.data);
 const pending=backups.create();store.data.positions['123456'].amount=99;store.save();
 const backup=await pending,info=await backups.inspect(backup.id),restored=await backups.read(backup.id);
 assert.equal(info.funds,1);assert.equal(restored.positions['123456'].amount,10);
 assert.deepEqual(restored.records,expected.records);
 const safety=await backups.create('before-restore');store.replace(restored);
 assert.equal(new Store(file).data.positions['123456'].amount,10);
 assert.equal((await backups.read(safety.id)).positions['123456'].amount,99);
 const unrelated=new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'qdii-restore-')),'state.json'));unrelated.replace(restored);
 assert.deepEqual(new Store(unrelated.file).data.records,expected.records);
 assert.throws(()=>backups.file('../state.json'),/不存在/);
 fs.writeFileSync(backups.file(backup.id),'broken');await assert.rejects(backups.read(backup.id));
 const current=fs.readFileSync(file);await assert.rejects(backups.read(backup.id));assert.deepEqual(fs.readFileSync(file),current);
 for(let i=0;i<4;i++)await backups.create('before-import');
 assert.equal(backups.list().length,3);assert.equal(backups.list().filter(b=>b.kind==='auto').length,0);
 assert.ok(!backups.list().some(b=>b.id===backup.id));
 const kept=backups.list().map(b=>b.id);store.data.version=999;await assert.rejects(backups.create('before-import'));assert.deepEqual(backups.list().map(b=>b.id),kept);
});
