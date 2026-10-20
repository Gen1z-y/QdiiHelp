import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configureQuoteCache,readQuoteCache,writeQuoteCache,clearQuoteCache,hedged} from '../lib/quote-cache.mjs';

test('quote cache survives a fresh module and rejects expired or corrupt files; reset forces refetch',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-quotes-'));configureQuoteCache(dir);
 writeQuoteCache('stock','prices');
 const fresh=await import('../lib/quote-cache.mjs?fresh');fresh.configureQuoteCache(dir);
 assert.equal(fresh.readQuoteCache('stock',3600000).data,'prices');
 writeQuoteCache('old','prices',Date.now()-4000000);assert.equal(readQuoteCache('old',3600000),null);
 for(const file of fs.readdirSync(dir))fs.writeFileSync(path.join(dir,file),'invalid');
 assert.equal(readQuoteCache('stock',3600000),null);
 writeQuoteCache('stock','prices');clearQuoteCache();assert.equal(readQuoteCache('stock',3600000),null);
 configureQuoteCache(null);
});
test('hedge uses fast primary without launching backup, and rescues slow or failed primary',async()=>{
 let backups=0;
 assert.equal(await hedged(async()=>1,async()=>{backups++;return 2;},10),1);assert.equal(backups,0);
 assert.equal(await hedged(()=>new Promise(()=>{}),async()=>2,10),2);
 assert.equal(await hedged(async()=>{throw Error('primary');},async()=>3,10000),3);
 assert.equal(await hedged(async()=>{await new Promise(r=>setTimeout(r,20));return 4;},async()=>{throw Error('backup');},1),4);
 await assert.rejects(hedged(async()=>{throw Error('primary');},async()=>{throw Error('backup');},1),/backup/);
});
