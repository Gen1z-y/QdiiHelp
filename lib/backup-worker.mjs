import fs from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {parentPort,workerData} from 'node:worker_threads';
import {atomicWrite,loadState,validateState} from './storage-format.mjs';
try{
 const {mode,file,target,manifest}=workerData;
 if(mode==='create-data'){
  const createdAt=new Date().toISOString(),data=workerData.data;
  atomicWrite(target,gzipSync(JSON.stringify({format:'qdii-backup-v1',createdAt,data,history:workerData.history})));
  parentPort.postMessage({createdAt,funds:data.watchlist.length,records:Object.keys(data.records).length});
 }else if(mode==='create'){
  const data=loadState(file,()=>{},manifest),createdAt=new Date().toISOString();
  atomicWrite(target,gzipSync(JSON.stringify({format:'qdii-backup-v1',createdAt,data})));
  parentPort.postMessage({createdAt,funds:data.watchlist.length,records:Object.keys(data.records).length});
 }else{
  const backup=JSON.parse(gunzipSync(fs.readFileSync(file),{maxOutputLength:512*1024*1024}).toString('utf8'));
  if(backup.format!=='qdii-backup-v1')throw new Error('不支持的备份格式');
  validateState(backup.data);
  if(mode==='read'&&backup.history)backup.data.$backupHistory=backup.history;
  parentPort.postMessage(mode==='read'?backup.data:{createdAt:backup.createdAt,funds:backup.data.watchlist.length,records:Object.keys(backup.data.records).length});
 }
}catch(e){parentPort.postMessage({error:e.message});}
