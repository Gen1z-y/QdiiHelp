import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {databaseConfig} from '../lib/database-config.mjs';
import {PostgresRuntime} from '../lib/postgres-runtime.mjs';
import {digest} from '../lib/storage-format.mjs';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const folders=['data','outputs'];const remove=process.argv.includes('--remove-verified');
const runtime=await PostgresRuntime.open(databaseConfig());let files=0,bytes=0;
function inventory(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=path.join(dir,e.name);return e.isDirectory()&&!e.isSymbolicLink()?inventory(p):[p];});}
function sourceBytes(file){return fs.lstatSync(file).isSymbolicLink()?Buffer.from(JSON.stringify({kind:'symlink',target:fs.readlinkSync(file)})):fs.readFileSync(file);}
try{
 for(const name of folders){const base=path.resolve(root,name);if(path.dirname(base)!==root||!folders.includes(path.basename(base)))throw Error('清理目录越界');if(!fs.existsSync(base))continue;
  const list=inventory(base);for(const file of list){
   const stat=fs.lstatSync(file),original=sourceBytes(file),relative=path.relative(root,file).replaceAll('\\','/');
   await runtime.archive(relative,original,stat.mtime);
   if(relative.startsWith('data/quote-cache/')&&relative.endsWith('.json'))try{const v=JSON.parse(original);if(typeof v.key==='string'&&Number.isFinite(v.time))runtime.write(v.key,v.data,v.time);}catch{}
   if(relative.startsWith('data/state.json.backups/')&&/\.json\.gz$/.test(relative)){
    const backup=JSON.parse(gunzipSync(original));if(backup.format==='qdii-backup-v1'){
     const id=path.basename(file),metadata={createdAt:backup.createdAt,kind:id.split('-').slice(3,-1).join('-'),funds:backup.data.watchlist.length,records:Object.keys(backup.data.records).length};
     await runtime.pool.query('INSERT INTO app_backups(id,content,checksum,metadata,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[id,original,digest(original),metadata,backup.createdAt]);
    }
   }
   files++;bytes+=original.length;
  }
  await runtime.flush();
  // Verify every stored byte again against the current source, not just insertion results.
  for(const file of list){const relative=path.relative(root,file).replaceAll('\\','/');const row=(await runtime.pool.query('SELECT content,checksum,raw_bytes FROM project_archives WHERE path=$1',[relative])).rows[0];const source=sourceBytes(file),restored=gunzipSync(row.content);if(source.length!==Number(row.raw_bytes)||digest(source)!==row.checksum||!source.equals(restored))throw Error('归档校验失败，保留源文件：'+relative);}
  if(remove){const current=inventory(base);if(current.length!==list.length||current.some((p,i)=>p!==list[i]))throw Error('目录发生变化，停止清理');for(const file of list)if(fs.lstatSync(file).isSymbolicLink()){try{fs.unlinkSync(file);}catch(e){if(['EPERM','EISDIR'].includes(e.code))fs.rmdirSync(file);else throw e;}}fs.rmSync(base,{recursive:true});}
 }
 runtime.log('migration',JSON.stringify({operation:'archive-project-data',files,bytes,removed:remove,verified:true}));await runtime.flush();console.log(JSON.stringify({files,bytes,removed:remove,verified:true}));
}finally{await runtime.close();}
