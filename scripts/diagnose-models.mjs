// Explicitly read-only export/analysis. Never imports the application server.
import fs from 'node:fs/promises';import path from 'node:path';import pg from 'pg';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {databaseConfig} from '../lib/database-config.mjs';import {chinaDate} from '../lib/model.mjs';import {diagnoseFund,diagnosisMarkdown} from '../lib/model-diagnostics.mjs';
const output=process.argv[2];if(!output)throw Error('请指定输出报告绝对路径，且不覆盖运行数据');
if(!path.isAbsolute(output)||!output.endsWith('.md'))throw Error('输出必须是独立的绝对路径.md报告');
const config=databaseConfig(),client=new pg.Client({...config,application_name:'qdiihelp_readonly_model_diagnosis',options:(config.options??'')+' -c default_transaction_read_only=on'});
const blobs=new Map();
async function unpack(value){
 if(value&&typeof value==='object'&&Object.keys(value).length===1&&value.$snapshot){
  const hash=value.$snapshot;if(blobs.has(hash))return blobs.get(hash);
  const result=await client.query('SELECT content,raw_bytes FROM snapshot_blobs WHERE hash=$1',[hash]);if(!result.rows[0])throw Error('输入快照缺失');
  const bytes=gunzipSync(result.rows[0].content);if(bytes.length!==result.rows[0].raw_bytes||createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('输入快照校验失败');
  const parsed=JSON.parse(bytes);blobs.set(hash,parsed);return parsed;
 }return value;
}
async function resolve(value){value=await unpack(value);if(!value||typeof value!=='object')return value;if(Array.isArray(value))return Promise.all(value.map(resolve));const result={};for(const [key,child] of Object.entries(value))result[key]=await resolve(child);return result;}
await client.connect();
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 if((await client.query("SELECT current_setting('transaction_read_only') AS mode")).rows[0].mode!=='on')throw Error('只读事务未启用');
 const codes=(await client.query("SELECT payload FROM app_settings WHERE key='watchlist'")).rows[0]?.payload??[];
 const profiles=new Map((await client.query('SELECT code,payload FROM funds WHERE code=ANY($1::text[])',[codes])).rows.map(r=>[r.code,r.payload.profile??{}]));
 const views=new Map((await client.query('SELECT DISTINCT ON (code) code,payload FROM fund_views WHERE code=ANY($1::text[]) ORDER BY code,nav_date DESC',[codes])).rows.map(r=>[r.code,r.payload]));
 const observations=(await client.query('SELECT key,code,payload FROM (SELECT key,code,payload,row_number() OVER(PARTITION BY code ORDER BY nav_date DESC) AS n FROM observations WHERE code=ANY($1::text[])) AS recent WHERE n<=200 ORDER BY code,key DESC',[codes])).rows;
 const items=[];
 for(const code of codes){
  const records={};let includedInputs=false;
  for(const row of observations.filter(r=>r.code===code)){
   const raw=row.payload,r={actual:raw.actual,firstForecastAt:raw.firstForecastAt,firstActualSeenAt:raw.firstActualSeenAt};
   if(raw.forecast){const f=await unpack(raw.forecast),small={};for(const k of ['date','base','holdingsDate','model','calculatedAt'])if(f[k]!==undefined)small[k]=await resolve(f[k]);if(!includedInputs){for(const k of ['rows','fx','dailyFx','fit'])if(f[k]!==undefined)small[k]=await resolve(f[k]);includedInputs=true;}r.forecast=small;}
   records[row.key]=r;
  }
  const profile=profiles.get(code)??{},view=views.get(code)??{};items.push(diagnoseFund({code,name:profile.name??view.name??code,profile,records,latestView:view}));
  blobs.clear();
 }
 await client.query('COMMIT');const report={asOf:chinaDate(),readOnly:true,items};
 await fs.writeFile(output,diagnosisMarkdown(report));await fs.writeFile(output.replace(/\.md$/,'.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({readOnly:true,funds:items.length,fundsWithPairedSamples:items.filter(f=>f.samples>0).length,fundsWithAtLeast10Samples:items.filter(f=>f.samples>=10).length,output}));
}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{await client.end();}
