import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {holdingsPie} from '../public/holdings-ui.js';
test('all browser module dependencies are served by the real HTTP server',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-static-'));
 process.env.PORT='8801';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:[],records:{},lastView:{}}));
 const {server}=await import('../server.mjs');
 try{
  if(!server.listening)await new Promise(r=>server.once('listening',r));
  const origin='http://127.0.0.1:8801';
  const home=await fetch(origin);assert.equal(home.status,200);
  const html=await home.text();
  const pending=[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>new URL(m[1],origin));
  const seen=new Set();
  while(pending.length){
   const url=pending.pop();if(seen.has(url.href))continue;seen.add(url.href);
   const response=await fetch(url);assert.equal(response.status,200,url.pathname);
   assert.match(response.headers.get('content-type'),/javascript/,url.pathname);
   const source=await response.text();
   for(const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+|\/[^'"]+)['"]/g))pending.push(new URL(match[1],url));
  }
  assert.ok(seen.has(origin+'/holdings-ui.js'));
  assert.equal((await fetch(origin+'/not-exposed.js')).status,404);
  // The existing CSP forbids inline styles, so chart geometry and color use SVG attributes.
  const chart=holdingsPie([{name:'sample',weight:40}]);
  assert.match(chart,/<svg/);assert.doesNotMatch(chart,/style=/);
 }finally{await new Promise(r=>server.close(r));}
});
