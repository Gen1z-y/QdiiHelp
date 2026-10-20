import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {archiveDir,archiveName,loadState,digest,atomicWrite} from './storage-format.mjs';

// Run only with exclusive access (before opening Store, or while the server is idle).
// New generation files precede the atomic manifest commit. A crash before commit
// leaves the old generation usable; a crash after it only leaves extra files.
// The result carries the manifest that is now on disk as a non-enumerable `raw`
// so startup can reuse the parse; reports and JSON.stringify never see it.
function withRaw(result,raw){return Object.defineProperty(result,'raw',{value:raw,enumerable:false});}
export function compactArchives(file,{force=false,beforeCommit=()=>{}}={}){
 if(!fs.existsSync(file))return {saved:0};
 const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(![2,3].includes(raw.storageVersion))return withRaw({saved:0},raw);
 const dir=path.resolve(archiveDir(file));
 if(!fs.existsSync(dir)&&Object.keys(raw.archives??{}).length===0)return withRaw({saved:0},raw);
 const names=fs.readdirSync(dir).filter(n=>archiveName.test(n)&&fs.lstatSync(path.join(dir,n)).isFile());
 const before=names.reduce((n,f)=>n+fs.statSync(path.join(dir,f)).size,0);
 const live=Object.values(raw.archives).reduce((n,r)=>n+r.length+1,0);
 if(!force&&(before-live<16*1024*1024||(before-live)/before<.25))return withRaw({before,after:before,saved:0},raw);
 const original=digest(JSON.stringify(loadState(file))),tag=randomBytes(8).toString('hex'),created=[],handles=new Map(),refs={};
 const fileCache=new Map();
 const slice=name=>{let b=fileCache.get(name);if(b===undefined){b=fs.readFileSync(path.join(dir,name));if(name.endsWith('.gz'))b=gunzipSync(b);fileCache.set(name,b);}return b;};
 const staged=file+'.compact-'+tag;let committed=false;
 try{
  for(const [id,ref] of Object.entries(raw.archives)){
   if(!archiveName.test(ref.file))throw new Error('无效归档文件名');
   const buf=slice(ref.file),bytes=buf.subarray(ref.offset,ref.offset+ref.length);
   if(bytes.length!==ref.length||digest(bytes)!==id)throw new Error('归档校验失败，取消整理');
   const name=ref.file.slice(0,7)+'-'+tag+'.ndjson.gz';let target=handles.get(name);
   if(!target){target={chunks:[],offset:0};handles.set(name,target);created.push(name);}
   refs[id]={...ref,file:name,offset:target.offset,length:bytes.length};target.chunks.push(bytes,Buffer.from('\n'));target.offset+=bytes.length+1;
  }
  for(const [name,h] of handles){fs.writeFileSync(path.join(dir,name),gzipSync(Buffer.concat(h.chunks)));handles.delete(name);}
  const next={...raw,archives:refs};atomicWrite(staged,JSON.stringify(next));
  if(digest(JSON.stringify(loadState(file,()=>{},staged)))!==original)throw new Error('整理前后数据不一致，取消切换');
  beforeCommit();atomicWrite(file,JSON.stringify(next));committed=true;
  for(const name of names){const target=path.resolve(dir,name);if(path.dirname(target)!==dir)throw new Error('清理路径越界');fs.unlinkSync(target);}
  return withRaw({before,after:live,saved:before-live},next);
 }finally{
  handles.clear();
  if(fs.existsSync(staged))fs.unlinkSync(staged);
  if(!committed)for(const name of created)if(fs.existsSync(path.join(dir,name)))fs.unlinkSync(path.join(dir,name));
 }
}

export function compressMigrationBackup(file){
 const source=file+'.before-monthly-storage.bak',target=source+'.gz';
 if(!fs.existsSync(source))return {saved:0};
 const bytes=fs.readFileSync(source),compressed=gzipSync(bytes);
 if(digest(gunzipSync(compressed))!==digest(bytes))throw new Error('备份压缩校验失败');
 if(fs.existsSync(target)){if(digest(gunzipSync(fs.readFileSync(target)))!==digest(bytes))throw new Error('已有压缩备份内容不同，保留原文件');}
 else atomicWrite(target,compressed);
 if(digest(gunzipSync(fs.readFileSync(target)))!==digest(bytes))throw new Error('备份落盘校验失败');
 fs.unlinkSync(source);return {saved:bytes.length-fs.statSync(target).size};
}

export function rotateLog(file,maxBytes=2*1024*1024,keep=3){
 if(!fs.existsSync(file)||fs.statSync(file).size<maxBytes)return;
 if(fs.existsSync(file+'.'+keep))fs.unlinkSync(file+'.'+keep);
 for(let n=keep-1;n>=1;n--)if(fs.existsSync(file+'.'+n))fs.renameSync(file+'.'+n,file+'.'+(n+1));
 fs.renameSync(file,file+'.1');
}
