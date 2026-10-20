import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {Store} from '../lib/store.mjs';
import {PostgresStore} from '../lib/postgres-store.mjs';
import {databaseConfig} from '../lib/database-config.mjs';
import {legacyPath} from '../lib/legacy-path.mjs';
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const file=legacyPath(process.argv[2]),config=databaseConfig();
// Refuse an import while the existing service might change the source files.
try{
 const response=await fetch('http://127.0.0.1:'+(process.env.PORT??8787)+'/api/health',{signal:AbortSignal.timeout(1500)});
 const health=await response.json();if(health.app==='qdii-help')throw Error('项目服务仍在运行，请先关闭服务再迁移');
}catch(e){if(e.message.includes('服务仍在运行'))throw e;}
const legacy=new Store(file);const clean=JSON.parse(JSON.stringify(legacy.data));
const target=path.join(path.dirname(file),'migration-backups');fs.mkdirSync(target,{recursive:true});
const backup=path.join(target,'before-postgres-'+Date.now()+'.json.gz');
const history={};const dir=path.join(path.dirname(file),'history');
if(fs.existsSync(dir))for(const name of fs.readdirSync(dir).filter(n=>/^\d{6}\.json$/.test(n))){const h=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));if(h.schema===2)history[name.slice(0,6)]=h;}
fs.writeFileSync(backup,gzipSync(JSON.stringify({format:'qdii-backup-v1',createdAt:new Date().toISOString(),data:clean,history})));
let db;
try{
 db=await PostgresStore.open(file,config,{initialData:clean});
 if(db.hashes.size)throw Error('数据库已有项目记录，为避免覆盖取消导入');
 db.restoreHistory=history;await db.save();db.restoreHistory=null;await db.close();db=null;
 const restored=await PostgresStore.open(file,config);db=restored;
 const expected=JSON.parse(JSON.stringify(clean)),actual=JSON.parse(JSON.stringify(restored.data));
 // View audit data duplicates its record and is deliberately reconstructed.
 for(const [key,v] of Object.entries(expected.lastView)){v.record=expected.records[key]??v.record??{};if(v.record.forecast)delete v.analysis;}
 if(!isDeepStrictEqual(actual,expected))throw Error('迁移前后状态核对不一致，禁止启用数据库');
 if(!isDeepStrictEqual(Object.fromEntries(restored.history),history))throw Error('历史净值核对不一致');
 const sizes=await restored.pool.query("SELECT pg_database_size(current_database())::bigint AS database_bytes,(SELECT count(*) FROM snapshot_blobs)::int AS snapshots");
 const report={verified:true,funds:clean.watchlist.length,records:Object.keys(clean.records).length,views:Object.keys(clean.lastView).length,historyFunds:Object.keys(history).length,backup,...sizes.rows[0]};
 fs.writeFileSync(path.join(target,'postgres-migration-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{if(db)await db.close();}
