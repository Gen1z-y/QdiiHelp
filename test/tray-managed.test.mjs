import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import fs from 'node:fs';

test('managed backend saves a streamed refresh before exiting, and closes on parent EOF', {timeout:30000}, async()=>{
 const probe=net.createServer();
 await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
 const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 async function run(eof){
  const child=spawn(process.execPath,['tray/managed-entry.mjs'],{
   cwd:new URL('..',import.meta.url),env:{...process.env,QDII_TRAY_FIXTURE:'1',QDII_PREVIEW_PORT:String(port)},stdio:['pipe','pipe','pipe']
  });
  let output='',errors='';const events=[];
  child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>errors+=chunk);
  const exit=once(child,'exit');
  try{
   for(let i=0;i<100&&!output.includes('"type":"ready"');i++){
    if(child.exitCode!==null)throw Error(output+errors);await new Promise(resolve=>setTimeout(resolve,30));
   }
   assert.match(output,/"type":"ready"/);
   if(!eof){
    const response=await fetch(`http://127.0.0.1:${port}/api/funds?stream=1&group=held`);
    const reader=response.body.getReader();let buffer='';
    const first=await reader.read();buffer+=new TextDecoder().decode(first.value);
    child.stdin.write('{"command":"stop"}\n');
    for(;;){const {done,value}=await reader.read();if(done)break;buffer+=new TextDecoder().decode(value);}
    events.push(...buffer.trim().split('\n').map(JSON.parse));
    assert.ok(events.some(e=>e.type==='result'&&e.data.items[0]?.code==='006337'),buffer);
   }else child.stdin.end();
   const [code]=await exit;assert.equal(code,0,output+errors);assert.match(output,/"type":"stopped"/);
   const statePath=output.match(/数据存储：(.*state\.json)/)?.[1]?.trim();assert.ok(statePath,output);
   const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
   if(!eof)assert.ok(Object.values(state.lastView).some(v=>v.code==='006337'));
  }finally{if(child.exitCode===null){child.kill();await exit;}}
 }
 await run(false);await run(true);
});
