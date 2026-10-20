import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {loadState,archiveDir} from '../lib/storage-format.mjs';
import {estimateMarket} from '../lib/model.mjs';
import {shiftDate} from '../lib/calendar.mjs';

function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-perf-'));
 const file=path.join(dir,'state.json');
 const store=new Store(file);
 const row=i=>({code:'C'+i,secid:'105.C'+i,weight:1,currency:'USD',
  stock:{base:{date:'2026-10-08',close:100},target:{date:'2026-10-09',close:100+i},return:i/100},
  fx:{base:{date:'2026-10-08'},target:{date:'2026-10-09'},return:.001},
  dailyStock:{base:{date:'2026-10-08',close:100},target:{date:'2026-10-09',close:100+i},return:i/100},
  dailyFx:{base:{date:'2026-10-08'},target:{date:'2026-10-09'},return:.001},
  dailyRmbReturn:i/100,rmbReturn:i/100});
 for(let f=0;f<20;f++){
  const code=String(100000+f);
  store.data.watchlist.push(code);
  for(let d=0;d<10;d++){
   const date=shiftDate('2026-10-09',-d),rows=Array.from({length:50},(_,i)=>row(i));
   const base={date:shiftDate(date,-1),value:1};
   store.data.records[code+':'+date]={forecast:{date,base,rows,model:{...estimateMarket(base,rows),method:'market-close-v4'},calculatedAt:'2026-10-10T00:00:00Z'}};
  }
 }
 store.save();
 return {dir,file};
}

test('storage stays within performance budgets and the verify watermark persists',()=>{
 const {dir,file}=fixture();
 try{
  let t=Date.now();const first=loadState(file);const firstMs=Date.now()-t;
  assert.ok(firstMs<4000,'loadState budget exceeded: '+firstMs+'ms');
  const store=new Store(file);store.save();
  assert.ok(Object.getOwnPropertyDescriptor(store.data,'archiveVerify')?.value,'watermark missing after load');
  t=Date.now();store.save();const saveMs=Date.now()-t;
  assert.ok(saveMs<4000,'save budget exceeded: '+saveMs+'ms');
  t=Date.now();loadState(file);const warmMs=Date.now()-t;
  assert.ok(warmMs<4000,'warm loadState budget exceeded: '+warmMs+'ms');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('tampering an archive file is caught once its mtime changes',()=>{
 const {dir,file}=fixture();
 try{
  loadState(file);
  const store=new Store(file);store.save();
  const archive=fs.readdirSync(archiveDir(file))[0];
  const p=path.join(archiveDir(file),archive);
  const buf=fs.readFileSync(p);buf[buf.length-2]^=0xff;
  fs.writeFileSync(p,buf);
  assert.throws(()=>loadState(file),/校验失败/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
