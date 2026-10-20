import fs from 'node:fs';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {chinaDate} from './model.mjs';
function worker(args){return new Promise((resolve,reject)=>{
 const w=new Worker(new URL('./backup-worker.mjs',import.meta.url),{workerData:args});
 w.once('message',r=>r.error?reject(new Error(r.error)):resolve(r));w.once('error',reject);w.once('exit',code=>{if(code)reject(new Error('备份工作进程退出：'+code));});
});}
export class Backups{
 constructor(store){this.store=store;this.dir=store.file+'.backups';this.task=null;this.lastError=null;}
 list(){return fs.existsSync(this.dir)?fs.readdirSync(this.dir).filter(n=>/^\d{4}-\d{2}-\d{2}-(auto|manual|before-restore|before-import)-[a-f0-9]+\.json\.gz$/.test(n)).map(id=>({id,bytes:fs.statSync(path.join(this.dir,id)).size,createdAt:fs.statSync(path.join(this.dir,id)).mtime.toISOString(),kind:id.split('-').slice(3,-1).join('-')})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)):[];}
 file(id){if(typeof id!=='string'||!this.list().some(b=>b.id===id))throw new Error('备份不存在，请重新选择');return path.join(this.dir,id);}
 async create(kind='manual'){
  // Chain creation, so every worker reads its own stable committed manifest.
  const previous=this.task;
  const run=async()=>{
   if(previous)await previous.catch(()=>{});
   if(this.store.backend==='postgres')await this.store.save();else this.store.save();fs.mkdirSync(this.dir,{recursive:true});
   const id=`${chinaDate()}-${kind}-${randomUUID().replaceAll('-','')}.json.gz`,target=path.join(this.dir,id);
   if(this.store.backend==='postgres'){
    const result=await worker({mode:'create-data',data:this.store.data,history:Object.fromEntries(this.store.history),target});
    this.prune();this.lastError=null;return {id,...result};
   }
   const snapshot=path.join(this.dir,'.snapshot-'+randomUUID()+'.json');
   fs.copyFileSync(this.store.file,snapshot);
   try{
    const result=await worker({mode:'create',file:this.store.file,target,manifest:snapshot});
    // Only prune after a new complete backup has been written successfully.
    this.prune();this.lastError=null;return {id,...result};
   }finally{fs.unlinkSync(snapshot);}
  };
  const task=run();this.task=task;try{return await task;}catch(e){this.lastError=e.message;throw e;}finally{if(this.task===task)this.task=null;}
 }
 prune(){
  const base=path.resolve(this.dir);
  for(const entry of this.list().slice(3)){
   const file=path.resolve(this.file(entry.id));
   if(path.dirname(file)!==base)throw new Error('备份清理路径无效');
   fs.unlinkSync(file);
  }
 }
 inspect(id){return worker({mode:'inspect',file:this.file(id)});}
 async read(id){const result=await worker({mode:'read',file:this.file(id)});return result;}
}
