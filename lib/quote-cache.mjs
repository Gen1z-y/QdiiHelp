import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
// Configured by the server so tests and alternate data directories stay isolated.
let directory=null;
let database=null;
let cacheBytes=0,lastPrune=0;
const limit=128*1024*1024;
export function configureQuoteCache(dir){database=null;directory=dir;cacheBytes=0;lastPrune=0;try{pruneQuoteCache();}catch{/* A locked cache must not prevent startup. */}}
export function configureDatabaseQuoteCache(storage){directory=null;database=storage;database.prune();}
export function pruneQuoteCache({maxBytes=limit,maxAge=7*86400000,now=Date.now()}={}){
 if(database)return database.prune({maxBytes,maxAge,now});
 if(!directory||!fs.existsSync(directory)){cacheBytes=0;lastPrune=now;return {bytes:0,removed:0};}
 const entries=fs.readdirSync(directory).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).flatMap(n=>{const file=path.join(directory,n),s=fs.lstatSync(file);return s.isFile()?[{file,bytes:s.size,time:s.mtimeMs}]:[];}).sort((a,b)=>a.time-b.time);
 let total=entries.reduce((n,e)=>n+e.bytes,0),removed=0;
 for(const e of entries)if(now-e.time>maxAge||total>maxBytes){fs.unlinkSync(e.file);total-=e.bytes;removed++;}
 cacheBytes=total;lastPrune=now;return {bytes:total,removed};
}
const filename=key=>path.join(directory,createHash('sha256').update(key).digest('hex')+'.json');
export function readQuoteCache(key,ttl){
 if(database)return database.read(key,ttl);
 if(!directory)return null;
 try{const file=filename(key),value=JSON.parse(fs.readFileSync(file,'utf8'));if(value.key===key&&Date.now()-value.time<ttl)return value;const size=fs.statSync(file).size;fs.unlinkSync(file);cacheBytes=Math.max(0,cacheBytes-size);return null;}catch{return null;}
}
export function writeQuoteCache(key,data,time=Date.now()){
 if(database){database.write(key,data,time);return;}
 if(!directory)return;
 try{fs.mkdirSync(directory,{recursive:true});const file=filename(key),old=fs.existsSync(file)?fs.statSync(file).size:0,bytes=Buffer.from(JSON.stringify({key,data,time}));fs.writeFileSync(file+'.tmp',bytes);fs.renameSync(file+'.tmp',file);cacheBytes+=bytes.length-old;if(cacheBytes>limit||Date.now()-lastPrune>3600000)pruneQuoteCache({maxBytes:cacheBytes>limit?112*1024*1024:limit});}catch{/* Cache failure must not block quotes. */}
}
export function clearQuoteCache(){
 if(database){database.clear();return;}
 if(!directory)return;
 try{for(const file of fs.readdirSync(directory))if(/^[a-f0-9]{64}\.json$/.test(file))fs.unlinkSync(path.join(directory,file));}catch{}
 cacheBytes=0;lastPrune=0;
}
// Start the backup early on failure, or after a short head start for the primary.
export async function hedged(primary,backup,delay=2500){
 let timer,start;const trigger=new Promise(resolve=>{start=resolve;timer=setTimeout(resolve,delay);});
 const first=Promise.resolve().then(primary).catch(error=>{start();throw error;});
 let finished=false;
 const second=trigger.then(()=>{if(finished)return new Promise(()=>{});return backup();});
 try{return await Promise.any([first,second]);}
 catch(error){throw error.errors?.at(-1)??error;}
 finally{finished=true;clearTimeout(timer);}
}
