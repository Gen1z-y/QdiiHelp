import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {navObservation} from '../lib/nav-observation.mjs';
import {shiftDate} from '../lib/calendar.mjs';
import {configureQuoteCache} from '../lib/quote-cache.mjs';

test('首页屏蔽旧第三方缓存，官方刷新独立运行，断网保留带警告的官方数据',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-official-api-')),date=navObservation();
 process.env.PORT='0';process.env.QDII_STORAGE='json';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:[],records:{},lastView:{},fxDisplay:{[date]:{date,close:9,dailyReturn:.1,source:'Frankfurter / ECB'}}}));
 const realFetch=globalThis.fetch;let server,offline=false,calls=0;
 globalThis.fetch=async(input,options)=>{
  const url=new URL(String(input));if(url.hostname==='127.0.0.1')return realFetch(input,options);
  assert.equal(url.hostname,'www.chinamoney.com.cn');calls++;if(offline)throw Error('测试断网');
  const end=url.searchParams.get('endDate');return {ok:true,text:async()=>JSON.stringify({head:{rep_code:'200'},data:{currency:'USD/CNY'},records:[{date:end,values:['6.7147']},{date:shiftDate(end,-1),values:['6.7165']}]})};
 };
 try{
  ({server}=await import('../server.mjs'));if(!server.listening)await new Promise(r=>server.once('listening',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const read=async route=>(await realFetch(origin+route)).json();
  assert.equal((await read('/api/funds?cached=1')).fx,null);assert.equal(calls,0,'读取缓存不自动访问外部数据源');
  const refresh=async()=>{await read('/api/funds?date=auto');for(let i=0;i<100;i++){const r=await read('/api/history-sync');if(!r.fxUpdating)return r.fx;await new Promise(r=>setTimeout(r,10));}throw Error('汇率任务未结束');};
  const first=await refresh();assert.equal(first.authority,'CFETS');assert.equal(first.close,6.7147);assert.equal(calls,1);
  configureQuoteCache(null);offline=true;
  const last=await refresh();assert.equal(last.authority,'CFETS');assert.equal(last.close,first.close);assert.equal(last.savedAt,first.savedAt);assert.match(last.updateError,/测试断网/);assert.equal(calls,2);
  assert.equal((await read('/api/funds?cached=1')).fx.close,first.close);
 }finally{if(server)await new Promise(r=>server.close(r));globalThis.fetch=realFetch;configureQuoteCache(null);assert.equal(path.dirname(dir),os.tmpdir());fs.rmSync(dir,{recursive:true,force:true});}
});
