// Offline, verified migration. Refuses to run while the application port is occupied.
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';
import {randomBytes} from 'node:crypto';import {gzipSync,gunzipSync} from 'node:zlib';
import {Store} from '../lib/store.mjs';
import {loadState,archiveDir,archiveName,digest,atomicWrite} from '../lib/storage-format.mjs';
import {legacyPath} from '../lib/legacy-path.mjs';
const file=legacyPath(process.argv[2]),parent=path.dirname(file),port=Number(process.env.PORT??8787);
const guard=net.createServer();await new Promise((resolve,reject)=>{guard.once('error',()=>reject(Error('请先停止 QdiiHelp 服务，再迁移资料')));guard.listen(port,'127.0.0.1',resolve);});
const tag=randomBytes(8).toString('hex'),stage=fs.mkdtempSync(path.join(parent,'.shared-migration-')),stagedFile=path.join(stage,'state.json'),manifest=file+'.shared-stage-'+tag;
let committed=false;const copied=[];
try{
 const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(raw.storageVersion===3){console.log(JSON.stringify({alreadyMigrated:true}));}
 else{
  const dir=path.resolve(archiveDir(file));fs.mkdirSync(dir,{recursive:true});
  const oldNames=fs.readdirSync(dir).filter(n=>archiveName.test(n));
  const before=fs.statSync(file).size+oldNames.reduce((n,f)=>n+fs.statSync(path.join(dir,f)).size,0);
  const source=new Store(file),original=JSON.stringify(source.data),hash=digest(original);
  const backup=file+'.before-shared-storage-'+tag+'.json.gz',compressed=gzipSync(original);
  if(digest(gunzipSync(compressed))!==hash)throw Error('备份校验失败');atomicWrite(backup,compressed);
  if(digest(gunzipSync(fs.readFileSync(backup)))!==hash)throw Error('备份落盘校验失败');
  const target=new Store(stagedFile);target.data=source.data;target.save();
  if(digest(JSON.stringify(new Store(stagedFile).data))!==hash)throw Error('副本逐项内容校验失败');
  const bytesBefore=fs.readdirSync(archiveDir(stagedFile)).reduce((n,f)=>n+fs.statSync(path.join(archiveDir(stagedFile),f)).size,0);
  target.save();
  if(fs.readdirSync(archiveDir(stagedFile)).reduce((n,f)=>n+fs.statSync(path.join(archiveDir(stagedFile),f)).size,0)!==bytesBefore)throw Error('重复保存产生多余资料');
  const next=JSON.parse(fs.readFileSync(stagedFile)),names=new Map();
  for(const ref of Object.values(next.archives)){
   if(!names.has(ref.file)){
    const name=ref.file.slice(0,7)+'-'+tag+'.ndjson',dest=path.resolve(dir,name);
    if(path.dirname(dest)!==dir)throw Error('归档路径越界');
    fs.copyFileSync(path.join(archiveDir(stagedFile),ref.file),dest,fs.constants.COPYFILE_EXCL);copied.push(dest);names.set(ref.file,name);
    const fd=fs.openSync(dest,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   }
   ref.file=names.get(ref.file);
  }
  atomicWrite(manifest,JSON.stringify(next));
  const reloaded=loadState(file,()=>{},manifest);for(const [key,v] of Object.entries(reloaded.lastView??{}))v.record=reloaded.records[key]??v.record??{};
  if(digest(JSON.stringify(reloaded))!==hash)throw Error('切换前完整数据校验失败');
  atomicWrite(file,JSON.stringify(next));committed=true;
  if(digest(JSON.stringify(new Store(file).data))!==hash)throw Error('切换后校验失败；保留备份和旧归档');
  for(const name of oldNames){const old=path.resolve(dir,name);if(path.dirname(old)!==dir||copied.includes(old))throw Error('旧归档清理路径无效');fs.unlinkSync(old);}
  const after=fs.statSync(file).size+copied.reduce((n,f)=>n+fs.statSync(f).size,0);
  console.log(JSON.stringify({verified:true,records:Object.keys(source.data.records).length,hash,beforeBytes:before,afterBytes:after,savedBytes:before-after,backup,backupBytes:fs.statSync(backup).size,sharedObjects:Object.keys(next.archives).length}));
 }
}finally{
 if(fs.existsSync(manifest))fs.unlinkSync(manifest);
 if(!committed)for(const name of copied)if(path.dirname(name)===path.resolve(archiveDir(file))&&fs.existsSync(name))fs.unlinkSync(name);
 if(path.dirname(path.resolve(stage))===parent&&path.basename(stage).startsWith('.shared-migration-'))fs.rmSync(stage,{recursive:true,force:true});
 await new Promise(resolve=>guard.close(resolve));
}
