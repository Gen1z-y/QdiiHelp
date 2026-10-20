// Read the source only; migrate and verify a temporary copy, then remove that copy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../lib/store.mjs';
import {loadState,archiveDir} from '../lib/storage-format.mjs';
import {legacyPath} from '../lib/legacy-path.mjs';
const source=legacyPath(process.argv[2]);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-migration-check-')),file=path.join(temp,'state.json');
try{
 const original=loadState(source);fs.writeFileSync(file,JSON.stringify(original));
 const before=fs.statSync(file).size,store=new Store(file),start=performance.now();store.save();const migrationMs=performance.now()-start;
 const reopened=new Store(file);assert.deepEqual(reopened.data.records,original.records);assert.deepEqual(reopened.data.positions,original.positions);assert.deepEqual(reopened.data.incomeRecords,original.incomeRecords);
 const archiveBytes=()=>fs.readdirSync(archiveDir(file)).reduce((n,f)=>n+fs.statSync(path.join(archiveDir(file),f)).size,0),archiveBefore=archiveBytes();
 const saveStart=performance.now();store.save();const saveMs=performance.now()-saveStart;assert.equal(archiveBytes(),archiveBefore);
 console.log(JSON.stringify({records:Object.keys(original.records).length,beforeBytes:before,mainBytes:fs.statSync(file).size,archiveBytes:archiveBefore,migrationMs:Math.round(migrationMs),unchangedSaveMs:Math.round(saveMs),verified:true}));
}finally{
 const resolved=path.resolve(temp),base=path.resolve(os.tmpdir());
 if(path.dirname(resolved)===base&&path.basename(resolved).startsWith('qdii-migration-check-'))fs.rmSync(resolved,{recursive:true,force:true});
}
