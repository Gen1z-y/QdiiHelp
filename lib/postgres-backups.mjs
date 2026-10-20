import {randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {digest,validateState} from './storage-format.mjs';
import {chinaDate} from './model.mjs';
export class PostgresBackups{
 static async open(store){const b=new this();b.store=store;b.task=null;b.lastError=null;await b.reload();return b;}
 async reload(){this.entries=(await this.store.pool.query('SELECT id,octet_length(content) AS bytes,metadata,created_at FROM app_backups ORDER BY created_at DESC,id DESC')).rows.map(r=>({id:r.id,bytes:r.bytes,createdAt:r.metadata.createdAt??r.created_at.toISOString(),kind:r.metadata.kind??'manual'}));}
 list(){return this.entries;}
 async create(kind='manual'){
  const previous=this.task;
  const run=async()=>{
   if(previous)await previous.catch(()=>{});await this.store.save();await this.store.flush();
   const createdAt=new Date().toISOString(),data=this.store.data,history=await this.store.allHistory();
   const content=gzipSync(JSON.stringify({format:'qdii-backup-v1',createdAt,data,history}));
   const id=`${chinaDate()}-${kind}-${randomUUID().replaceAll('-','')}.json.gz`,metadata={createdAt,kind,funds:data.watchlist.length,records:Object.keys(data.records).length,historyFunds:Object.keys(history).length};
   await this.store.pool.query('INSERT INTO app_backups(id,content,checksum,metadata) VALUES($1,$2,$3,$4)',[id,content,digest(content),metadata]);
   await this.reload();await this.prune();this.lastError=null;return {id,...metadata};
  };
  const task=run();this.task=task;try{return await task;}catch(e){this.lastError=e.message;throw e;}finally{if(this.task===task)this.task=null;}
 }
 async prune(){await this.store.pool.query('DELETE FROM app_backups WHERE id NOT IN (SELECT id FROM app_backups ORDER BY created_at DESC,id DESC LIMIT 3)');await this.reload();}
 async unpack(id){const r=await this.store.pool.query('SELECT content,checksum FROM app_backups WHERE id=$1',[id]);if(!r.rowCount)throw Error('备份不存在，请重新选择');const row=r.rows[0];if(digest(row.content)!==row.checksum)throw Error('备份完整性校验失败');const backup=JSON.parse(gunzipSync(row.content,{maxOutputLength:512*1024*1024}));if(backup.format!=='qdii-backup-v1')throw Error('不支持的备份格式');validateState(backup.data);return backup;}
 async inspect(id){const b=await this.unpack(id);return {createdAt:b.createdAt,funds:b.data.watchlist.length,records:Object.keys(b.data.records).length};}
 async read(id){const b=await this.unpack(id);if(b.history)b.data.$backupHistory=b.history;return b.data;}
}
