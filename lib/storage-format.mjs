import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const archiveDir=file=>file+'.archive';
export const archiveName=/^\d{4}-\d{2}(?:-[a-f0-9]{16})?\.ndjson(\.gz)?$/;
export function freezeSnapshot(value){
 if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
 for(const child of Object.values(value))freezeSnapshot(child);
 return Object.freeze(value);
}
export function validateState(data){
 if(data?.version!==1||!Array.isArray(data.watchlist)||data.watchlist.length>60||data.watchlist.some(c=>!/^\d{6}$/.test(c))||new Set(data.watchlist).size!==data.watchlist.length)throw new Error('保存的数据格式不正确，已停止操作，避免覆盖');
 for(const key of ['records','lastView'])if(!data[key]||typeof data[key]!=='object'||Array.isArray(data[key]))throw new Error('数据缺少 '+key);
 return data;
}
export function loadState(file,onArchive=()=>{},manifestFile=file,preparsed){
 const raw=preparsed??JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 if(raw.storageVersion!==undefined&&![2,3].includes(raw.storageVersion))throw new Error('不支持的存储版本，已停止读取');
 if(![2,3].includes(raw.storageVersion))return validateState(raw);
 if(!raw.archives||typeof raw.archives!=='object')throw new Error('审计归档索引缺失');
 const entries=new Map(),loading=new Set(),fileCache=new Map(),statCache=new Map();
 // Digests are re-checked unless a previous full load already verified this
 // exact file (same size and mtime) up to beyond the blob's end.
 const verify=raw.archiveVerify??{};
 function blob(ref){
  let buf=fileCache.get(ref.file);
  if(buf===undefined){
   try{
    const p=path.join(archiveDir(file),ref.file);
    buf=fs.readFileSync(p);statCache.set(ref.file,fs.statSync(p));
    if(ref.file.endsWith('.gz'))buf=gunzipSync(buf);
   }catch{buf=null;statCache.set(ref.file,null);}
   fileCache.set(ref.file,buf);
  }
  if(!buf||ref.offset+ref.length>buf.length)throw new Error('审计归档不完整或校验失败，已停止读取');
  return buf.subarray(ref.offset,ref.offset+ref.length);
 }
 function revive(value){
  if(!value||typeof value!=='object')return value;
  if(Object.keys(value).length===1&&typeof value.$archive==='string'){
   const id=value.$archive,ref=raw.archives[id];
   if(!ref||!archiveName.test(ref.file)||!Number.isSafeInteger(ref.offset)||ref.offset<0||!Number.isSafeInteger(ref.length)||ref.length<1||ref.length>128*1024*1024||!/^[a-f0-9]{64}$/.test(id))throw new Error('审计归档索引无效');
   if(entries.has(id))return entries.get(id);
   const bytes=blob(ref);
   const wm=verify[ref.file],st=statCache.get(ref.file);
   const skipped=wm&&st&&wm.size===st.size&&wm.mtime===st.mtimeMs&&ref.offset+ref.length<=wm.bytes;
   if(!skipped&&digest(bytes)!==id)throw new Error('审计归档不完整或校验失败，已停止读取');
   if(loading.has(id))throw new Error('归档循环引用，已停止读取');
   loading.add(id);
   const payload=JSON.parse(bytes.toString('utf8')),children=[];
   function references(v){if(!v||typeof v!=='object')return;if(Object.keys(v).length===1&&typeof v.$archive==='string'){children.push(v.$archive);return;}for(const child of Object.values(v))references(child);}
   if(raw.storageVersion===3)references(payload);
   const result=raw.storageVersion===3?revive(payload):payload;
   loading.delete(id);entries.set(id,result);onArchive(result,id,{...ref,children:[...new Set(children)]});return result;
  }
  for(const [key,child] of Object.entries(value))value[key]=revive(child);
  return value;
 }
 const {archives,storageVersion,...state}=raw;
 const revived=validateState(revive(state));
 // Non-enumerable: invisible to deepEqual/JSON.stringify, persisted explicitly by Store.save.
 Object.defineProperty(revived,'archiveVerify',{enumerable:false,value:Object.fromEntries([...statCache].filter(([,s])=>s).map(([name,s])=>[name,{size:s.size,mtime:s.mtimeMs,bytes:fileCache.get(name).length}]))});
 return revived;
}
export function atomicWrite(file,bytes){
 const temp=file+'.tmp';const fd=fs.openSync(temp,'w');
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temp,file);
}
