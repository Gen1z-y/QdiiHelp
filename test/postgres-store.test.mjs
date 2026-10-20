import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import pg from 'pg';
import {PostgresStore} from '../lib/postgres-store.mjs';
import {PostgresBackups} from '../lib/postgres-backups.mjs';
import {databaseConfig} from '../lib/database-config.mjs';
import {PostgresRuntime} from '../lib/postgres-runtime.mjs';
import {configureDatabaseQuoteCache,configureQuoteCache,readQuoteCache,writeQuoteCache,clearQuoteCache} from '../lib/quote-cache.mjs';

test('PostgreSQL persists deltas, shared snapshots, history, deletion and backup restore',{skip:process.env.QDII_PG_TEST!=='1'},async()=>{
 const config=databaseConfig();const schema='qdii_test_'+Date.now();
 const admin=new pg.Client(config);await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 const isolated={...config,options:'-c search_path='+schema};const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'qdii-pg-')),'state.json');let store;
 try{
  const forecast={date:'2026-10-12',base:{date:'2026-10-09',value:1},model:{return:.02,value:1.02},rows:[{code:'X',weight:90}]};
  const data={version:1,watchlist:['111111'],fundGroups:{'111111':'held'},profiles:{'111111':{profile:{name:'测试基金'}}},records:{'111111:2026-10-12':{forecast,sealedAt:'original'}},lastView:{'111111:2026-10-12':{code:'111111',date:'2026-10-12',record:{forecast},latestHoldings:{asOf:'2026-06-30',rows:[{code:'X',weight:90}]}}},holdingsSnapshots:{'111111':{asOf:'2026-06-30',rows:[{code:'X',weight:90}]}}};
  store=await PostgresStore.open(file,isolated,{initialData:data});await store.save();await store.save();assert.equal(store.lastWrite.changed,0);assert.equal(store.lastWrite.blobs,0);
  store.data.records['111111:invalid-date']={forecast:{...forecast,model:{value:999},rows:[{code:'BAD',weight:80}]}};
  const before=(await store.pool.query('SELECT count(*)::int AS count FROM snapshot_blobs')).rows[0].count;
  await assert.rejects(store.save());assert.equal((await store.pool.query('SELECT count(*)::int AS count FROM snapshot_blobs')).rows[0].count,before,'failed transactions roll back snapshots too');
  delete store.data.records['111111:invalid-date'];await store.save();
  const history={schema:2,code:'111111',rows:[{date:'2026-10-09',value:1,dailyReturn:0}]};await store.saveHistory('111111',history);
  await store.close();store=await PostgresStore.open(file,isolated);assert.equal(store.history.size,0,'NAV rows are not loaded at startup');assert.deepEqual(store.data.records['111111:2026-10-12'].forecast,forecast);assert.deepEqual(await store.readHistory('111111'),history);
  const backup=await PostgresBackups.open(store),saved=await backup.create();
  store.data.records['111111:2026-10-12'].actual={date:'2026-10-12',value:1.03};await store.save();assert.equal(store.lastWrite.changed,1);assert.equal(store.data.records['111111:2026-10-12'].sealedAt,'original');
  await store.saveHistory('111111',{...history,rows:[]});await store.replace(await backup.read(saved.id));assert.equal(store.data.records['111111:2026-10-12'].actual,undefined);assert.deepEqual(await store.readHistory('111111'),history);
  delete store.data.records['111111:2026-10-12'];await store.save();store.data.records['111111:2026-10-12']={forecast,sealedAt:'original'};await store.save();
  await store.compact();await store.close();store=await PostgresStore.open(file,isolated);assert.equal(store.data.records['111111:2026-10-12'].forecast.model.value,1.02);
  let runtime=await PostgresRuntime.open(isolated);configureDatabaseQuoteCache(runtime);
  writeQuoteCache('test-stock',{close:123});runtime.log('test','数据库日志测试');await runtime.flush();await runtime.close();
  runtime=await PostgresRuntime.open(isolated);store.runtime=runtime;configureDatabaseQuoteCache(runtime);
  assert.equal(readQuoteCache('test-stock',3600000).data.close,123);
  assert.equal((await runtime.pool.query("SELECT count(*)::int AS count FROM runtime_logs WHERE kind='test'")).rows[0].count,1);
  writeQuoteCache('expired',1,Date.now()-8*86400000);await runtime.flush();assert.equal(readQuoteCache('expired',3600000),null);
  clearQuoteCache();await runtime.flush();assert.equal((await runtime.pool.query('SELECT count(*)::int AS count FROM quote_cache')).rows[0].count,0);configureQuoteCache(null);
  assert.equal(fs.existsSync(file),false,'database writes do not rewrite the legacy manifest');
  assert.deepEqual(fs.readdirSync(path.dirname(file)),[],'PG backups, cache and logs create no data files');
 }finally{if(store)await store.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
