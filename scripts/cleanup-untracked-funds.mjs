// Explicit maintenance: dry-run by default. Stop the backend before --apply.
import pg from 'pg';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {databaseConfig} from '../lib/database-config.mjs';
import {digest,validateState} from '../lib/storage-format.mjs';

const apply=process.argv.includes('--apply');
const tables=['funds','observations','fund_views','holding_versions','nav_history','history_metadata'];
const maps=['fundGroups','holdingsSnapshots','bondHoldingsSnapshots','bondRefs'];
const port=Number(process.env.PORT||8787);
async function backendStopped(){
 return new Promise((resolve,reject)=>{
  const socket=net.connect({host:'127.0.0.1',port});
  socket.setTimeout(2000,()=>{socket.destroy();reject(Error('无法确认后台停止状态'));});
  socket.once('connect',()=>{socket.destroy();reject(Error('请先通过托盘停止后台，再清理数据库'));});
  socket.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));
 });
}
function references(value,result=new Set()){
 if(!value||typeof value!=='object')return result;
 if(Object.keys(value).length===1&&typeof value.$snapshot==='string')result.add(value.$snapshot);
 else for(const child of Object.values(value))references(child,result);
 return result;
}
function cleanReport(report,active){
 if(!report?.items||!Array.isArray(report.items))return report;
 const items=report.items.filter(item=>active.has(item.code));
 if(items.length===report.items.length)return report;
 const result={...report,items,summary:Object.fromEntries(['updated','unchanged','failed','unsupported'].map(status=>[status,items.filter(item=>item.status===status).length]))};
 // Old aggregate counts cannot be reconstructed reliably after removing rows.
 delete result.refreshSummary;delete result.recalculation;
 if(result.data?.items)result.data={...result.data,items:result.data.items.filter(item=>active.has(item.code))};
 return result;
}
const client=new pg.Client(databaseConfig());await client.connect();
try{
 if(apply)await backendStopped();
 await client.query(apply?'BEGIN':'BEGIN READ ONLY');
 if(apply)await client.query('LOCK TABLE app_settings,funds,observations,fund_views,holding_versions,nav_history,history_metadata,sync_runs,snapshot_blobs IN EXCLUSIVE MODE');
 const settings=(await client.query('SELECT key,payload,content_hash FROM app_settings')).rows;
 const config=Object.fromEntries(settings.map(row=>[row.key,row.payload]));
 const codes=config.watchlist;
 if(!Array.isArray(codes)||codes.length!==32||new Set(codes).size!==32)throw Error('当前列表不再是已核对的32只基金，停止清理');
 const active=new Set(codes),before={},removed={};
 const dataTables={};
 for(const table of tables){
  const rows=(await client.query(`SELECT * FROM ${table}`)).rows;dataTables[table]=rows;
  before[table]=rows.length;removed[table]=rows.filter(row=>!active.has(row.code)).length;
 }
 const staleCodes=[...new Set(tables.flatMap(table=>dataTables[table].filter(row=>!active.has(row.code)).map(row=>row.code)).concat(maps.flatMap(field=>Object.keys(config[field]??{}).filter(code=>!active.has(code)))))].sort();
 console.log(JSON.stringify({mode:apply?'apply':'dry-run',active:codes.length,staleCodes,rowsToDelete:removed}));
 if(!apply){await client.query('ROLLBACK');process.exitCode=0;}
 else{
  const blobs=(await client.query('SELECT * FROM snapshot_blobs')).rows;
  const blobMap=new Map(blobs.map(blob=>[blob.hash,blob])),decoded=new Map();
  function hydrate(value){
   if(!value||typeof value!=='object')return value;
   if(Object.keys(value).length===1&&typeof value.$snapshot==='string'){
    const id=value.$snapshot;if(decoded.has(id))return decoded.get(id);
    const blob=blobMap.get(id);if(!blob)throw Error('备份引用的快照缺失：'+id);
    const bytes=gunzipSync(blob.content);if(bytes.length!==blob.raw_bytes||digest(bytes)!==id)throw Error('快照校验失败：'+id);
    const result=hydrate(JSON.parse(bytes));decoded.set(id,result);return result;
   }
   return Array.isArray(value)?value.map(hydrate):Object.fromEntries(Object.entries(value).map(([key,item])=>[key,hydrate(item)]));
  }
  const state=hydrate(config);
  for(const [field,table] of Object.entries({profiles:'funds',records:'observations',lastView:'fund_views'}))state[field]=Object.fromEntries(dataTables[table].map(row=>[row.key??row.code,hydrate(row.payload)]));
  validateState(state);
  const history=Object.fromEntries(dataTables.history_metadata.map(row=>[row.code,{...row.payload,rows:[]}]));
  for(const row of dataTables.nav_history){history[row.code]??={rows:[]};history[row.code].rows.push(row.payload);}
  for(const item of Object.values(history))item.rows.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const createdAt=new Date().toISOString();
  const backupId=createdAt.slice(0,10)+'-before-orphan-cleanup-'+randomUUID()+'.json.gz';
  const content=gzipSync(Buffer.from(JSON.stringify({format:'qdii-backup-v1',createdAt,data:state,history})));
  // A checkpoint is part of the transaction, so partial cleanup cannot commit.
  await client.query('INSERT INTO app_backups(id,content,checksum,metadata) VALUES($1,$2,$3,$4)',[backupId,content,digest(content),{createdAt,kind:'before-orphan-cleanup',funds:codes.length,records:dataTables.observations.length,historyFunds:Object.keys(history).length}]);
  for(const table of tables)await client.query(`DELETE FROM ${table} WHERE NOT(code=ANY($1::text[]))`,[codes]);
  for(const row of settings){
   let value=row.payload;
   if(maps.includes(row.key))value=Object.fromEntries(Object.entries(value).filter(([code])=>active.has(code)));
   if(row.key==='lastHoldingsSync')value=cleanReport(value,active);
   if(JSON.stringify(value)!==JSON.stringify(row.payload))await client.query('UPDATE app_settings SET payload=$2,content_hash=$3 WHERE key=$1',[row.key,value,digest(JSON.stringify(value))]);
  }
  for(const row of (await client.query('SELECT id,payload FROM sync_runs')).rows){
   const value=cleanReport(row.payload,active);
   if(JSON.stringify(value)!==JSON.stringify(row.payload))await client.query('UPDATE sync_runs SET payload=$2 WHERE id=$1',[row.id,value]);
  }
  const roots=new Set();
  for(const table of ['app_settings','funds','observations','fund_views','sync_runs'])for(const row of (await client.query(`SELECT payload FROM ${table}`)).rows)references(row.payload,roots);
  for(const row of (await client.query('SELECT snapshot_hash FROM holding_versions')).rows)roots.add(row.snapshot_hash);
  const live=new Set();
  function visit(id){if(live.has(id))return;const blob=blobMap.get(id);if(!blob)throw Error('现存数据引用的快照缺失：'+id);live.add(id);for(const child of blob.children??[])visit(child);}
  for(const id of roots)visit(id);
  const pruned=await client.query('DELETE FROM snapshot_blobs WHERE NOT(hash=ANY($1::text[]))',[[...live]]);
  const after={};
  for(const table of tables){
   const rows=(await client.query(`SELECT * FROM ${table}`)).rows;
   const retained=dataTables[table].filter(row=>active.has(row.code));
   if(rows.length!==retained.length||rows.some(row=>!active.has(row.code)))throw Error('清理后条数异常：'+table);
   const fingerprint=row=>JSON.stringify(row);
   const oldRows=new Set(retained.map(fingerprint));
   if(rows.some(row=>!oldRows.has(fingerprint(row))))throw Error('当前基金数据被修改：'+table);
   after[table]=rows.length;
  }
  if(after.funds!==32)throw Error('基金资料数量不是32，停止提交');
  await backendStopped();
  await client.query('COMMIT');
  console.log(JSON.stringify({committed:true,backupId,before,after,unreferencedSnapshotsDeleted:pruned.rowCount,activeFundsUnchanged:true},null,2));
 }
}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
finally{await client.end();}
