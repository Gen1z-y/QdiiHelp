import test from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';
async function wait(check,limit=300){for(let i=0;i<limit;i++){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,20));}throw Error('test timed out');}
test('tray refresh reports partial failures, retries only failed funds, and page requests share recoverable tasks',{timeout:30000},async()=>{
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['--import','./test/refresh-injection.mjs','tray/managed-entry.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,QDII_TRAY_FIXTURE:'1',QDII_PREVIEW_PORT:String(port)},stdio:['pipe','pipe','pipe']});const exit=once(child,'exit');let output='',errors='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>errors+=d);
 const origin='http://127.0.0.1:'+port,read=async path=>{const r=await fetch(origin+path);assert.equal(r.status,200);return r.json();};
 try{
  await wait(()=>output.includes('"type":"ready"'));
  child.stdin.write('{"command":"refresh","id":"qa-tray"}\n');
  await wait(()=>output.includes('"type":"refresh-started"'));
  const running=await read('/api/refresh');assert.equal(running.runs[0].status,'running');
  const duplicate=await fetch(origin+'/api/refresh',{method:'POST',body:'{}'}).then(r=>r.json());assert.equal(duplicate.id,running.runs[0].id,'tray and page share the same running task');
  await wait(()=>output.includes('"type":"refresh-result"'));
  const event=output.split('\n').filter(l=>l.startsWith('QDII_CONTROL ')).map(l=>JSON.parse(l.slice(13))).find(e=>e.type==='refresh-result');assert.equal(event.ok,true);assert.equal(event.warning,true);assert.match(event.message,/1 只刷新异常/);
  const report=(await read('/api/refresh')).runs[0];assert.equal(report.status,'partial');assert.deepEqual(report.items.filter(r=>r.error).map(r=>r.code),['123456']);
  const cached=await read('/api/funds?cached=1');assert.equal(cached.items.length,2,'failed first refresh retains the fund card');assert.match(cached.items.find(f=>f.code==='123456').error,/测试上游/);
  child.stdin.write('{"command":"test-recover"}\n');await new Promise(r=>setTimeout(r,30));
  const retryResponse=await fetch(origin+'/api/refresh/'+report.id+'/retry',{method:'POST',body:'{}'});assert.equal(retryResponse.status,202);const retry=await retryResponse.json();
  const complete=await wait(async()=>{const r=await read('/api/refresh/'+retry.id);return r.status!=='running'&&r;});assert.equal(complete.status,'complete');assert.deepEqual(complete.items.map(r=>r.code),['123456']);
  assert.equal((await read('/api/funds?cached=1')).items.find(f=>f.code==='123456').error??null,null);
  const controller=new AbortController();const streamed=await fetch(origin+'/api/funds?stream=1',{signal:controller.signal});const reader=streamed.body.getReader();await reader.read();controller.abort();await reader.cancel().catch(()=>{});
  const latest=await wait(async()=>{const r=(await read('/api/refresh')).runs[0];return r.id!==retry.id&&r;});
  await wait(async()=>['complete','partial'].includes((await read('/api/refresh/'+latest.id)).status));
  const runtime=await read('/api/runtime');assert.equal(runtime.operations.refreshes,0);assert.ok(runtime.lastSavedAt);assert.ok(runtime.calendars.some(c=>c.market==='KR'&&!c.covered));
  child.stdin.write('{"command":"refresh","id":"qa-before-stop"}\n');await wait(()=>output.includes('"type":"refresh-progress","id":"qa-before-stop"'));
  child.stdin.write('{"command":"stop"}\n');const [code]=await exit;assert.equal(code,0,output+errors);assert.match(output,/"type":"stopped"/);assert.ok(output.indexOf('"type":"refresh-result","id":"qa-before-stop"')<output.indexOf('"type":"stopped"'),'tray refresh saves and reports before shutdown completes');
 }finally{if(child.exitCode===null){child.kill();await exit;}}
});
