import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {PostgresStore} from '../lib/postgres-store.mjs';import {PostgresBackups} from '../lib/postgres-backups.mjs';import {databaseConfig} from '../lib/database-config.mjs';
test('PG history startup, fund/date queries, cache eviction and complete backups preserve all NAVs',{skip:process.env.QDII_PG_TEST!=='1'},async t=>{
 const config=databaseConfig();assert.notEqual(config.database,'qdiihelp','integration benchmark must use a non-production database');
 const admin=new pg.Client(config),schema='qdii_demand_'+Date.now();await admin.connect();await admin.query('CREATE SCHEMA '+schema);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-history-demand-')),file=path.join(dir,'state.json'),isolated={...config,options:'-c search_path='+schema};let store;
 try{
  const codes=Array.from({length:12},(_,i)=>String(100000+i));store=await PostgresStore.open(file,isolated,{initialData:{version:1,watchlist:codes,records:{},lastView:{}}});await store.save();
  const rows=Array.from({length:1500},(_,i)=>({date:new Date(Date.UTC(2026,9,15-i)).toISOString().slice(0,10),value:1+i/10000,dailyReturn:.001}));
  for(const code of codes)await store.saveHistory(code,{schema:2,code,totalCount:rows.length,rows,historyComplete:true,fetchedAt:new Date().toISOString()});
  await store.close();const start=performance.now();store=await PostgresStore.open(file,isolated);const startupMs=performance.now()-start;
  assert.equal(store.history.size,0);assert.equal(store.historyRecent.size,0);assert.equal(store.historyMetadata.size,12);
  const recent=await store.readHistory(codes[0],{recent:true});assert.equal(recent.rows.length,161);assert.deepEqual(recent.rows,rows.slice(0,161));assert.equal(store.history.size,0);
  const range=await store.readHistory(codes[1],{from:'2026-10-01',to:'2026-10-05'});assert.equal(range.rows.length,5);assert.equal(store.history.size,0);
  for(const code of codes)assert.deepEqual((await store.readHistory(code)).rows,rows);assert.equal(store.history.size,8);
  const backups=await PostgresBackups.open(store),saved=await backups.create(),restored=await backups.read(saved.id);assert.equal(Object.keys(restored.$backupHistory).length,12);assert.equal(Object.values(restored.$backupHistory).reduce((n,h)=>n+h.rows.length,0),18000);
  await store.replace(restored);assert.equal((await store.readHistory(codes[0])).rows.length,1500);
  t.diagnostic(JSON.stringify({datasetRows:18000,startupLoadedNavRows:0,summaryRows:161,dateRangeRows:5,maxFullCacheFunds:8,isolatedStartupMs:Math.round(startupMs)}));
 }finally{if(store)await store.close();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();fs.rmSync(dir,{recursive:true,force:true});}
});
