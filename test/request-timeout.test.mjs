import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import vm from 'node:vm';
import {requestJson,readLines} from '../public/request.js';
test('requests stop waiting on missing headers, incomplete JSON and stalled streams',async()=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/headers')return;
  if(req.url==='/json'){res.writeHead(200,{'Content-Type':'application/json'});res.write('{');return;}
  if(req.url==='/stream'){res.writeHead(200);res.write('first\n');return;}
  if(req.url==='/ok'){res.end('{"ok":true}');return;}
  res.writeHead(400,{'Content-Type':'application/json'});res.end('{"error":"specific failure"}');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  for(const route of ['/headers','/json'])await assert.rejects(requestJson(base+route,{},100),/长时间没有响应/);
  const lines=[];await assert.rejects(readLines(base+'/stream',{},line=>lines.push(line),100),/长时间没有响应/);assert.deepEqual(lines,['first']);
  assert.deepEqual(await requestJson(base+'/ok',{},1000),{ok:true});
  await assert.rejects(requestJson(base+'/error',{},1000),/specific failure/);
  await assert.rejects(readLines(base+'/stream',{},()=>{throw Error('render failed');},1000),/render failed/);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('regular stream progress renews the inactivity deadline and preserves split lines',async()=>{
 const server=http.createServer((req,res)=>{res.write('fir');let n=0;const timer=setInterval(()=>{n++;if(n===1)res.write('st\n');else if(n===6){res.end('last');clearInterval(timer);}else res.write('progress\n');},30);res.on('close',()=>clearInterval(timer));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const lines=[];await readLines('http://127.0.0.1:'+server.address().port,{},line=>lines.push(line),100);assert.equal(lines[0],'first');assert.equal(lines.at(-1),'last');assert.equal(lines.length,6);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('initial render failure releases refresh state and buttons',async()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');const start=source.indexOf('async function refresh(');const end=source.indexOf("function showHoldingsSync",start);const elements=new Map();
 const context=vm.createContext({document:{querySelectorAll:()=>[]},busy:false,holdingsBusy:false,forceRefreshing:false,sequence:0,activeDate:'',selected:null,items:[],render(){throw Error('broken view');},loadingProgress(){},notice(){},setHistorySyncStatus(){},$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}});
 vm.runInContext(source.slice(start,end),context);await context.refresh();assert.equal(context.busy,false);assert.equal(elements.get('#refresh').disabled,false);assert.equal(elements.get('#syncHoldings').disabled,false);assert.equal(elements.get('#fundLoading').hidden,true);
});
