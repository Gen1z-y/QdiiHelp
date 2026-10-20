import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
test('添加分组持久化，重复添加可换组且不复制，重新添加覆盖旧分组',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-groups-')),file=path.join(dir,'state.json');
 t.after(()=>{for(const name of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);});
 const s=new Store(file);s.add('006373','watch');s.add('012920','held');
 let saved=new Store(file);assert.equal(saved.data.fundGroups['006373'],'watch');assert.equal(saved.data.fundGroups['012920'],'held');
 s.add('006373','held');assert.equal(s.data.watchlist.filter(c=>c==='006373').length,1);
 s.remove('006373');s.add('006373','watch');saved=new Store(file);assert.equal(saved.data.fundGroups['006373'],'watch');
 const before=JSON.stringify(s.data);assert.throws(()=>s.add('123456','invalid'));assert.equal(JSON.stringify(s.data),before);
});
