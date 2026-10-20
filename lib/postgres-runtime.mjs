import fs from 'node:fs';
import pg from 'pg';
import {gzipSync,gunzipSync} from 'node:zlib';
import {digest} from './storage-format.mjs';
export class PostgresRuntime{
 static async open(config){
  const runtime=new this();runtime.pool=new pg.Pool(config);runtime.pool.on('error',e=>{runtime.error=e;});runtime.tail=Promise.resolve();runtime.cache=new Map();
  try{await runtime.pool.query(fs.readFileSync(new URL('./postgres-schema.sql',import.meta.url),'utf8'));
   for(const row of (await runtime.pool.query('SELECT key,content,cached_at,raw_bytes FROM quote_cache')).rows)runtime.cache.set(row.key,{...row,time:Number(row.cached_at),bytes:row.raw_bytes});
   runtime.prune();await runtime.flush();return runtime;
  }catch(e){await runtime.pool.end();throw e;}
 }
 enqueue(work){this.tail=this.tail.catch(()=>{}).then(work);this.tail.catch(e=>{this.error=e;});return this.tail;}
 async flush(){await this.tail;}
 read(key,ttl){const entry=this.cache.get(key);if(!entry)return null;if(Date.now()-entry.time>=ttl){this.cache.delete(key);this.enqueue(()=>this.pool.query('DELETE FROM quote_cache WHERE key=$1',[key]));return null;}try{const value=entry.value??=(JSON.parse(gunzipSync(entry.content)));if(value.key!==key||value.time!==entry.time)throw Error('缓存标识或时间不匹配');return value;}catch{this.cache.delete(key);this.enqueue(()=>this.pool.query('DELETE FROM quote_cache WHERE key=$1',[key]));return null;}}
 write(key,data,time=Date.now()){
  const value={key,data,time},bytes=Buffer.from(JSON.stringify(value)),content=gzipSync(bytes);this.cache.set(key,{value,content,time,bytes:bytes.length});
  this.enqueue(()=>this.pool.query('INSERT INTO quote_cache(key,content,cached_at,raw_bytes) VALUES($1,$2,$3,$4) ON CONFLICT(key) DO UPDATE SET content=excluded.content,cached_at=excluded.cached_at,raw_bytes=excluded.raw_bytes',[key,content,time,bytes.length]));
  this.prune();
 }
 clear(){this.cache.clear();this.enqueue(()=>this.pool.query('DELETE FROM quote_cache'));}
 prune({maxBytes=128*1024*1024,maxAge=7*86400000,now=Date.now()}={}){
  const entries=[...this.cache].sort((a,b)=>a[1].time-b[1].time);let bytes=entries.reduce((n,[,e])=>n+e.bytes,0);const keys=[];
  for(const [key,e] of entries)if(now-e.time>maxAge||bytes>maxBytes){keys.push(key);this.cache.delete(key);bytes-=e.bytes;}
  if(keys.length)this.enqueue(()=>this.pool.query('DELETE FROM quote_cache WHERE key=ANY($1::text[])',[keys]));return {bytes,removed:keys.length};
 }
 log(kind,message){if(!String(message).trim())return;this.enqueue(()=>this.pool.query('INSERT INTO runtime_logs(kind,message) VALUES($1,$2)',[kind,String(message)]));}
 async maintainLogs(){await this.flush();await this.pool.query('DELETE FROM runtime_logs WHERE id NOT IN (SELECT id FROM runtime_logs ORDER BY id DESC LIMIT 2000)');}
 async archive(name,bytes,modifiedAt){
  if(name.startsWith('/')||name.split('/').includes('..'))throw Error('归档路径无效');
  const checksum=digest(bytes);await this.pool.query('INSERT INTO project_archives(path,content,checksum,raw_bytes,modified_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(path) DO UPDATE SET content=excluded.content,checksum=excluded.checksum,raw_bytes=excluded.raw_bytes,modified_at=excluded.modified_at,archived_at=now()',[name,gzipSync(bytes),checksum,bytes.length,modifiedAt]);
 }
 async close(){await this.flush();await this.pool.end();}
}
