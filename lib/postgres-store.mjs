import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {gzipSync,gunzipSync} from 'node:zlib';
import {Store} from './store.mjs';
import {digest,validateState,freezeSnapshot} from './storage-format.mjs';

const tables={records:'observations',lastView:'fund_views',profiles:'funds'};
const large=new Set(['forecast','partialForecast','originalForecast','analysis','latestHoldings','challenger','rows','evidence','rejectedForecasts']);
const ref=v=>v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.$snapshot==='string';
function references(value,result=new Set()){
 if(!value||typeof value!=='object')return result;
 if(ref(value))result.add(value.$snapshot);else for(const child of Object.values(value))references(child,result);
 return result;
}
export class PostgresStore extends Store{
 static async open(file,config,{initialData}={}){
  const store=Object.create(this.prototype);store.file=file;store.backend='postgres';
  store.pool=new pg.Pool(config);store.pool.on('error',e=>{store.lastError=e;console.error('数据库连接异常：'+e.message);});
  store.tail=Promise.resolve();store.hashes=new Map();store.blobs=new Map();store.decoded=new Map();store.frozenRefs=new WeakMap();store.history=new Map();store.historyMetadata=new Map();store.historyRecent=new Map();store.historyLoads=new Map();
  try{
   await store.pool.query(fs.readFileSync(new URL('./postgres-schema.sql',import.meta.url),'utf8'));
   const marker=await store.pool.query("SELECT payload FROM app_settings WHERE key='version'");
   if(!marker.rowCount){if(!initialData)throw Error('数据库尚未导入项目数据，请先运行 npm run db:migrate');store.data=validateState(initialData);store.linkViews();return store;}
   for(const row of (await store.pool.query('SELECT hash,content,raw_bytes,children FROM snapshot_blobs')).rows)store.blobs.set(row.hash,row);
   store.data={};
   for(const row of (await store.pool.query('SELECT key,payload,content_hash FROM app_settings')).rows){store.data[row.key]=store.revive(row.payload);store.hashes.set('app_settings:'+row.key,row.content_hash);}
   for(const [field,table] of Object.entries(tables)){
    store.data[field]={};
    for(const row of (await store.pool.query(`SELECT ${table==='funds'?'code':'key'} AS key,payload,content_hash FROM ${table}`)).rows){store.data[field][row.key]=store.revive(row.payload);store.hashes.set(table+':'+row.key,row.content_hash);}
   }
   validateState(store.data);store.linkViews();
   const metadata=await store.pool.query('SELECT code,payload FROM history_metadata');
   for(const row of metadata.rows)store.historyMetadata.set(row.code,row.payload);
   return store;
  }catch(e){await store.pool.end();throw e;}
 }
 revive(value){
  if(!value||typeof value!=='object')return value;
  if(ref(value)){
   const id=value.$snapshot;if(this.decoded.has(id))return this.decoded.get(id);
   const blob=this.blobs.get(id);if(!blob)throw Error('数据库快照缺失：'+id);
   const bytes=gunzipSync(blob.content);if(bytes.length!==blob.raw_bytes||digest(bytes)!==id)throw Error('数据库快照校验失败：'+id);
   const result=this.revive(JSON.parse(bytes));this.decoded.set(id,result);freezeSnapshot(result);this.frozenRefs.set(result,id);return result;
  }
  for(const [key,child] of Object.entries(value)){
   if(ref(child)){
    let loaded=false,result;const store=this;
    Object.defineProperty(value,key,{enumerable:true,configurable:true,get(){if(!loaded){result=store.revive(child);loaded=true;}return result;},set(next){Object.defineProperty(value,key,{value:next,writable:true,enumerable:true,configurable:true});}});
   }else value[key]=this.revive(child);
  }
  return value;
 }
 encode(value,pending,blob=false){
  if(!value||typeof value!=='object')return value;
  const known=this.frozenRefs.get(value);if(known&&(this.blobs.has(known)||pending.has(known)))return {$snapshot:known};
  const output=Array.isArray(value)?value.map(v=>this.encode(v,pending)):Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.encode(v,pending,large.has(k))]));
  if(!blob)return output;
  const bytes=Buffer.from(JSON.stringify(output)),hash=digest(bytes);
  if(!this.blobs.has(hash)&&!pending.has(hash))pending.set(hash,{hash,content:gzipSync(bytes),raw_bytes:bytes.length,children:[...references(output)]});
  if(Object.isFrozen(value))this.frozenRefs.set(value,hash);
  return {$snapshot:hash};
 }
 save(){
  if(this.saveTimer){clearTimeout(this.saveTimer);this.saveTimer=null;}
  // Serialize calls; capture each committed update before the next write starts.
  validateState(this.data);const pending=new Map(),entities=[];
  for(const [field,value] of Object.entries(this.data)){
   if(['archiveVerify','archives','storageVersion'].includes(field))continue;
   if(tables[field])for(const [key,item] of Object.entries(value)){
    const clean=field==='lastView'?Object.fromEntries(Object.entries(item).filter(([k])=>k!=='record'&&!(k==='analysis'&&item.record?.forecast))):item;
    const payload=this.encode(clean,pending);entities.push({table:tables[field],key,payload,hash:digest(JSON.stringify(payload))});
   }else{
    const payload=this.encode(value,pending);entities.push({table:'app_settings',key:field,payload,hash:digest(JSON.stringify(payload))});
   }
  }
  const versions=[];
  for(const [field,kind] of [['holdingsSnapshots','stock'],['bondHoldingsSnapshots','bond']])for(const [code,h] of Object.entries(this.data[field]??{})){
   const payload=this.encode(h,pending,true);versions.push({id:code+':'+kind+':'+payload.$snapshot,code,kind,date:h.asOf,hash:payload.$snapshot});
  }
  const report=this.data.lastHoldingsSync?JSON.parse(JSON.stringify(this.data.lastHoldingsSync)):null;
  const historyRestore=this.restoreHistory;
  const operation=async()=>{
   const client=await this.pool.connect();
   try{
    await client.query('BEGIN');
    const blobs=[...pending.values()];
    for(let offset=0;offset<blobs.length;offset+=250){const batch=blobs.slice(offset,offset+250).map(b=>({hash:b.hash,content:b.content.toString('base64'),raw_bytes:b.raw_bytes,children:b.children}));
     await client.query("INSERT INTO snapshot_blobs(hash,content,raw_bytes,children) SELECT hash,decode(content,'base64'),raw_bytes,children FROM jsonb_to_recordset($1::jsonb) AS x(hash text,content text,raw_bytes integer,children text[]) ON CONFLICT(hash) DO NOTHING",[JSON.stringify(batch)]);
    }
    const changes=entities.filter(e=>this.hashes.get(e.table+':'+e.key)!==e.hash);
    for(const table of ['app_settings','funds','observations','fund_views']){
     const rows=changes.filter(e=>e.table===table).map(e=>({key:e.key,code:e.key.slice(0,6),nav_date:e.key.slice(7),payload:e.payload,content_hash:e.hash}));
     if(rows.length){const id=table==='funds'?'code':'key',dated=['observations','fund_views'].includes(table);
      await client.query(`INSERT INTO ${table}(${id},${dated?'code,nav_date,':''}payload,content_hash) SELECT ${id},${dated?'code,nav_date::date,':''}payload,content_hash FROM jsonb_to_recordset($1::jsonb) AS x(key text,code text,nav_date text,payload jsonb,content_hash text) ON CONFLICT(${id}) DO UPDATE SET payload=excluded.payload,content_hash=excluded.content_hash`,[JSON.stringify(rows)]);
     }
     const keys=entities.filter(e=>e.table===table).map(e=>e.key);await client.query(`DELETE FROM ${table} WHERE NOT (${table==='funds'?'code':'key'}=ANY($1::text[]))`,[keys]);
    }
    if(versions.length)await client.query('INSERT INTO holding_versions(id,code,kind,report_date,snapshot_hash) SELECT id,code,kind,date::date,hash FROM jsonb_to_recordset($1::jsonb) AS x(id text,code text,kind text,date text,hash text) ON CONFLICT(id) DO NOTHING',[JSON.stringify(versions)]);
    if(report)await client.query('INSERT INTO sync_runs(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',[report.serverTime??digest(JSON.stringify(report)),report]);
    if(historyRestore){
     await client.query('DELETE FROM nav_history');await client.query('DELETE FROM history_metadata');
     for(const [code,history] of Object.entries(historyRestore)){
      const {rows,...metadata}=history;
      await client.query('INSERT INTO history_metadata(code,payload) VALUES($1,$2)',[code,metadata]);
      if(rows.length)await client.query('INSERT INTO nav_history(code,nav_date,payload) SELECT $1,(v->>\'date\')::date,v FROM jsonb_array_elements($2::jsonb) AS v',[code,JSON.stringify(rows)]);
     }
    }
    await client.query('COMMIT');
    for(const b of pending.values())this.blobs.set(b.hash,b);this.hashes=new Map(entities.map(e=>[e.table+':'+e.key,e.hash]));
    if(historyRestore){this.history.clear();this.historyRecent.clear();this.historyMetadata=new Map(Object.entries(historyRestore).map(([code,{rows,...metadata}])=>[code,metadata]));}
    this.lastWrite={changed:changes.length,blobs:pending.size};this.lastSavedAt=new Date().toISOString();this.lastError=null;
   }catch(e){await client.query('ROLLBACK');this.lastError=e;throw e;}finally{client.release();}
  };
  this.tail=this.tail.catch(()=>{}).then(operation);this.tail.catch(e=>{this.lastError=e;});return this.tail;
 }
 async flush(){await this.tail;await this.runtime?.flush();if(this.lastError)throw this.lastError;}
 async replace(data){const previous=this.data;const {$backupHistory,...state}=data;this.restoreHistory=$backupHistory;this.data=validateState(state);this.linkViews();try{await this.save();}catch(e){this.data=previous;throw e;}finally{this.restoreHistory=null;}}
 async compact(){
  await this.save();const client=await this.pool.connect();
  try{
   await client.query('BEGIN');const roots=new Set();
   for(const table of ['app_settings','funds','observations','fund_views'])for(const row of (await client.query(`SELECT payload FROM ${table}`)).rows)references(row.payload,roots);
   for(const row of (await client.query('SELECT snapshot_hash FROM holding_versions')).rows)roots.add(row.snapshot_hash);
   const live=new Set();const visit=id=>{if(live.has(id))return;const b=this.blobs.get(id);if(!b)throw Error('快照引用缺失，停止清理');live.add(id);for(const child of b.children??[])visit(child);};
   for(const id of roots)visit(id);
   await client.query('DELETE FROM snapshot_blobs WHERE NOT(hash=ANY($1::text[]))',[[...live]]);await client.query('COMMIT');
   for(const id of this.blobs.keys())if(!live.has(id)){this.blobs.delete(id);this.decoded.delete(id);}
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async saveHistory(code,data){
  const client=await this.pool.connect();
  try{await client.query('BEGIN');const {rows,...metadata}=data;
   await client.query('INSERT INTO history_metadata(code,payload) VALUES($1,$2) ON CONFLICT(code) DO UPDATE SET payload=excluded.payload',[code,metadata]);
   await client.query('DELETE FROM nav_history WHERE code=$1',[code]);
   if(rows.length)await client.query('INSERT INTO nav_history(code,nav_date,payload) SELECT $1,(v->>\'date\')::date,v FROM jsonb_array_elements($2::jsonb) AS v',[code,JSON.stringify(rows)]);
   await client.query('COMMIT');this.historyMetadata.set(code,metadata);this.historyRecent.delete(code);this.cacheHistory(code,data);
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 cacheHistory(code,data){this.history.delete(code);this.history.set(code,data);while(this.history.size>8)this.history.delete(this.history.keys().next().value);}
 historySummary(code){return this.historyRecent.get(code)??this.history.get(code)??(this.historyMetadata.has(code)?{...this.historyMetadata.get(code),rows:[]}:null);}
 async readHistory(code,{from=null,to=null,recent=false}={}){
  if(!/^\d{6}$/.test(code))throw Error('无效的历史基金代码');
  if(!this.historyMetadata.has(code))return null;
  if(recent&&this.historyRecent.has(code))return this.historyRecent.get(code);
  const full=this.history.get(code);
  if(full)return from||to?{...full,rows:full.rows.filter(r=>(!from||r.date>=from)&&(!to||r.date<=to))}:full;
  const key=JSON.stringify([code,from,to,recent]);if(this.historyLoads.has(key))return this.historyLoads.get(key);
  const task=(async()=>{
   const values=[code],where=['code=$1'];
   for(const [date,op] of [[from,'>='],[to,'<=']])if(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('无效历史日期');values.push(date);where.push('nav_date'+op+'$'+values.length+'::date');}
   const rows=(await this.pool.query('SELECT payload FROM nav_history WHERE '+where.join(' AND ')+' ORDER BY nav_date DESC'+(recent?' LIMIT 161':''),values)).rows.map(r=>r.payload);
   const result={...this.historyMetadata.get(code),rows};
   if(recent)this.historyRecent.set(code,result);else if(!from&&!to)this.cacheHistory(code,result);
   return result;
  })().finally(()=>this.historyLoads.delete(key));this.historyLoads.set(key,task);return task;
 }
 async allHistory(){const result={};for(const code of this.historyMetadata.keys())result[code]=await this.readHistory(code);return result;}
 async close(){if(this.saveTimer)await this.save();await this.flush();await this.runtime?.close();await this.pool.end();}
}
