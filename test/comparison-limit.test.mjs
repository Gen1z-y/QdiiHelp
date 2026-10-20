import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {chinaDate,previousWeekday} from '../lib/model.mjs';

test('基金选择允许第8只并拒绝第9只',()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');const button={};let events=0;
 const selected=new Set(Array.from({length:7},(_,i)=>String(100000+i)));
 const context={comparing:selected,$:()=>button,renderPicker(){},renderComparison(){},document:{dispatchEvent(){events++;}},CustomEvent:class{}};
 vm.runInNewContext(source.split('\n').find(l=>l.startsWith("$('#comparePicker').onchange=")),context);
 const eighth={checked:true,dataset:{compare:'100007'}};button.onchange({target:eighth});assert.equal(selected.size,8);assert.equal(events,1);
 const ninth={checked:true,dataset:{compare:'100008'}};button.onchange({target:ninth});assert.equal(selected.size,8);assert.equal(ninth.checked,false);assert.match(button.textContent,/8只/);assert.equal(events,1);
});

test('历史接口返回8条基金曲线并拒绝9只',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-compare8-')),codes=Array.from({length:8},(_,i)=>String(100000+i));
 process.env.PORT='0';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:codes,records:{},lastView:{}}));
 const history=path.join(dir,'data','history');fs.mkdirSync(history,{recursive:true});const date=previousWeekday(),base=previousWeekday(new Date(date+'T12:00:00Z'));
 for(const code of codes)fs.writeFileSync(path.join(history,code+'.json'),JSON.stringify({schema:2,historyComplete:true,code,fetchedAt:new Date().toISOString(),rows:[{date:base,value:1,dailyReturn:0},{date,value:1.01,dailyReturn:.01}]}));
 const {server}=await import('../server.mjs');
 try{
  if(!server.listening)await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
  const response=await fetch(origin+'/api/history?codes='+codes.join(','));assert.equal(response.status,200);const data=await response.json();assert.equal(data.series.length,8);assert.ok(data.series.every(s=>s.points.length===2));
  const rejected=await fetch(origin+'/api/history?codes='+[...codes,'100008'].join(','));assert.equal(rejected.status,400);assert.match((await rejected.json()).error,/8只/);
 }finally{await new Promise(r=>server.close(r));assert.ok(path.basename(dir).startsWith('qdii-compare8-'));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});}
});
