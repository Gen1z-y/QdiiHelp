// Explicit offline maintenance; run with --apply after stopping this project's server.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
import {loadState,digest,atomicWrite,validateState} from '../lib/storage-format.mjs';
import {compactArchives} from '../lib/storage-maintenance.mjs';
import {configureQuoteCache,pruneQuoteCache} from '../lib/quote-cache.mjs';
import {legacyPath} from '../lib/legacy-path.mjs';
const root=legacyPath(process.env.QDII_LEGACY_ROOT);
function safe(relative){const target=path.resolve(root,relative);if(!target.startsWith(root+path.sep))throw new Error('Path outside workspace');let current=target;while(current!==root){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error('Symbolic link refused');current=path.dirname(current);}return target;}
if(!process.argv.includes('--apply'))throw new Error('Stop the server, then run with --apply');
let running=false;try{running=(await(await fetch('http://127.0.0.1:8787/api/health',{signal:AbortSignal.timeout(1500)})).json()).app==='qdii-help';}catch{}
if(running)throw new Error('Stop QdiiHelp before offline cleanup');
const report={removed:[],moved:[],backups:[],warnings:[]};
function remove(relative,reason){const file=safe(relative);if(!fs.existsSync(file))return;if(!fs.lstatSync(file).isFile())throw new Error('Expected file');report.removed.push({path:relative,bytes:fs.statSync(file).size,reason});fs.unlinkSync(file);}
function move(from,to){const source=safe(from),target=safe(to);if(!fs.existsSync(source))return;if(fs.existsSync(target))throw new Error('Destination exists: '+to);fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(source,target);report.moved.push({from,to});}
const stateFile=safe('data/state.json');
const original=loadState(stateFile),originalHash=digest(JSON.stringify(original));
report.dataBefore={funds:original.watchlist.length,records:Object.keys(original.records).length,sha256:originalHash};
// Preserve one verified, self-contained recovery point before compacting archives.
const recovery=safe('data/legacy-backups/2026-10-07-before-cleanup.json.gz');
if(!fs.existsSync(recovery)){fs.mkdirSync(path.dirname(recovery),{recursive:true});atomicWrite(recovery,gzipSync(JSON.stringify({format:'qdii-backup-v1',createdAt:new Date().toISOString(),data:original}),{level:9}));}
if(digest(JSON.stringify(JSON.parse(gunzipSync(fs.readFileSync(recovery))).data))!==originalHash)throw new Error('Recovery point differs; do not overwrite');
// Old v2 manifest backups depend on archive offsets. Materialize them before compaction.
for(const name of fs.readdirSync(safe('data')).filter(n=>/^state\.json\..+\.bak(?:\.gz)?$/.test(n))){
 const relative='data/'+name,file=safe(relative),bytes=fs.readFileSync(file),raw=JSON.parse((name.endsWith('.gz')?gunzipSync(bytes):bytes).toString());
 let full=raw;
 if(raw.storageVersion===2){const temp=safe('data/cleanup-manifest.tmp');try{atomicWrite(temp,JSON.stringify(raw));full=loadState(stateFile,()=>{},temp);}catch(e){report.warnings.push({path:relative,error:e.message});continue;}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
 validateState(full);
 const target='data/legacy-backups/'+name.replace(/\.gz$/,'')+'.gz',dest=safe(target);
 const packed=gzipSync(JSON.stringify(full),{level:9});
 if(fs.existsSync(dest))throw new Error('Backup destination exists');atomicWrite(dest,packed);
 if(digest(JSON.stringify(JSON.parse(gunzipSync(fs.readFileSync(dest)))))!==digest(JSON.stringify(full)))throw new Error('Backup verification failed');
 report.backups.push({from:relative,to:target,materialized:raw.storageVersion===2,sha256:digest(JSON.stringify(full))});remove(relative,'Verified standalone compressed backup relocated');
}
// If a historical manifest cannot be read, leave its archive files untouched.
report.compaction=report.warnings.length||fs.existsSync(safe('data/legacy-backups/incomplete'))?{skipped:true,reason:'Unresolved legacy backup references'}:compactArchives(stateFile,{force:true});
const after=loadState(stateFile);if(digest(JSON.stringify(after))!==originalHash)throw new Error('State changed during cleanup');
report.dataAfter={funds:after.watchlist.length,records:Object.keys(after.records).length,sha256:originalHash};
// Compare logical backup payloads, not gzip timestamps or envelope creation dates.
const seen=new Map();
for(const dir of ['data/state.json.backups','data/legacy-backups']){if(!fs.existsSync(safe(dir)))continue;for(const name of fs.readdirSync(safe(dir)).filter(n=>n.endsWith('.gz'))){const relative=dir+'/'+name,parsed=JSON.parse(gunzipSync(fs.readFileSync(safe(relative)))),data=parsed.format==='qdii-backup-v1'?parsed.data:parsed;validateState(data);const hash=digest(JSON.stringify(data));if(seen.has(hash))remove(relative,'Duplicate backup payload of '+seen.get(hash));else seen.set(hash,relative);}}
if(fs.existsSync(safe('系统说明'))&&digest(fs.readFileSync(safe('系统说明')))===digest(fs.readFileSync(safe('图片/项目核心功能海报.png'))))remove('系统说明','Exact duplicate of 图片/项目核心功能海报.png');
for(const name of ['server.log','server-error.log','data/write-check.txt','data/write-check-node.txt'])remove(name,'Obsolete log or write probe');
for(const name of fs.readdirSync(safe('docs')).filter(n=>/\.(png|jpg)$/i.test(n))){if(name==='fund-returns-2026-09-30.png')move('docs/'+name,'图片/历史导出/'+name);else remove('docs/'+name,'Superseded development UI screenshot');}
move('docs/branding/douyin-cover-1080-v1.jpg','图片/品牌素材/douyin-cover-1080-v1.jpg');
for(const name of fs.readdirSync(safe('data')).filter(n=>/^backup-compression-.*\.json$/.test(n)))move('data/'+name,'docs/reports/'+name);
for(const name of ['100只基金分类核对.md','analyze.py','funds.json'])move('data/fund-image-analysis/'+name,'docs/research/fund-image-analysis/'+name);
for(const relative of ['data/ocr-temp','data/fund-image-analysis','docs/branding']){const dir=safe(relative);if(fs.existsSync(dir)&&fs.readdirSync(dir).length===0)fs.rmdirSync(dir);}
const cacheDir=safe('data/quote-cache');configureQuoteCache(cacheDir);report.cache=pruneQuoteCache();
fs.mkdirSync(safe('docs/reports'),{recursive:true});atomicWrite(safe('docs/reports/cleanup-2026-10-07.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
