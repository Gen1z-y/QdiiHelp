import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {databaseConfig} from './lib/database-config.mjs';
import {PostgresRuntime} from './lib/postgres-runtime.mjs';
process.chdir(fileURLToPath(new URL('.',import.meta.url)));
const runtime=await PostgresRuntime.open(databaseConfig());
for(const [kind,stream] of [['stdout',process.stdout],['stderr',process.stderr]]){const original=stream.write.bind(stream);stream.write=(chunk,...args)=>{runtime.log(kind,Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk));return process.env.QDII_NO_BROWSER==='1'?true:original(chunk,...args);};}
console.log('\nSTART '+new Date().toISOString()+' | Node '+process.version);
const port=Number(process.env.PORT||8787);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT must be between 1024 and 65535');
function open(){if(process.env.QDII_NO_BROWSER!=='1')spawn('cmd.exe',['/d','/c','start','',`http://127.0.0.1:${port}/`],{windowsHide:true,stdio:'ignore'}).unref();}
try{
  let existing=null;try{existing=await(await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(800)})).json();}catch{}
  if(existing?.app==='qdii-help'){console.log('Already running. Opening the existing service.');open();await runtime.close();}
  else {const {server}=await import('./server.mjs');if(server.listening)open();else server.once('listening',open);server.once('close',()=>void runtime.close());}
}catch(e){console.error('START FAILED:',e.stack);await runtime.close();process.exitCode=1;}
