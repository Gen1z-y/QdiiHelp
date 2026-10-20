import fs from 'node:fs';
import pg from 'pg';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {databaseConfig} from '../lib/database-config.mjs';
import {PostgresStore} from '../lib/postgres-store.mjs';
import {digest} from '../lib/storage-format.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const db=new pg.Client(databaseConfig());await db.connect();let store;
try{
 for(const name of ['data','outputs'])if(fs.existsSync(new URL('../'+name,import.meta.url)))throw Error('工程目录存在运行数据：'+name);
 const rows=(await db.query('SELECT path,content,checksum,raw_bytes FROM project_archives')).rows;
 for(const row of rows){const bytes=gunzipSync(row.content);if(bytes.length!==Number(row.raw_bytes)||digest(bytes)!==row.checksum)throw Error('旧文件归档损坏：'+row.path);}
 store=await PostgresStore.open('postgres:qdiihelp',databaseConfig());
 for(const [hash,blob] of store.blobs){const bytes=gunzipSync(blob.content);if(bytes.length!==blob.raw_bytes||digest(bytes)!==hash)throw Error('快照损坏：'+hash);for(const child of blob.children)if(!store.blobs.has(child))throw Error('快照子引用缺失：'+child);}
 const original=rows.filter(r=>r.path.startsWith('data/migration-backups/before-postgres-')).sort((a,b)=>a.path.localeCompare(b.path))[0];
 let sealed=0;
 if(original){const before=JSON.parse(gunzipSync(gunzipSync(original.content))).data;
  for(const [key,record] of Object.entries(before.records))if(record.sealedAt){const current=store.data.records[key];for(const field of ['forecast','sealedAt','firstForecastAt'])if(!isDeepStrictEqual(record[field],current?.[field]))throw Error('迁移前封存预估发生变化：'+key+' '+field);sealed++;}
 }
 const comments=await db.query("SELECT c.relname,a.attname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname='public' AND c.relkind='r' AND (obj_description(c.oid,'pg_class') IS NULL OR col_description(c.oid,a.attnum) IS NULL)");
 if(comments.rowCount)throw Error('表或字段备注缺失');
 const report={verified:true,archives:rows.length,snapshots:store.blobs.size,sealedForecastsUnchanged:sealed,funds:store.data.watchlist.length,records:Object.keys(store.data.records).length,engineeringDirectory:root,noRuntimeDirectories:true};
 await db.query('INSERT INTO runtime_logs(kind,message) VALUES($1,$2)',['storage-check',JSON.stringify(report)]);console.log(JSON.stringify(report,null,2));
}finally{if(store)await store.close();await db.end();}
