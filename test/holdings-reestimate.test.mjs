import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadState} from '../lib/storage-format.mjs';
import {forecastHoldingsChanged} from '../lib/holdings-version.mjs';
import {replaySealedForecasts} from '../lib/replay-audit.mjs';

test('持仓比较针对预估实际输入，忽略排序、名称和抓取时间，识别同日权重修订',()=>{
 const rows=[{code:'A',secid:'105.A',currency:'USD',weight:20},{code:'B',secid:'105.B',currency:'USD',weight:10}];
 const forecast={holdingsDate:'2026-09-30',rows,model:{method:'market-close-v4'}};
 const holding={asOf:forecast.holdingsDate,rows:[{...rows[1],name:'新名称'},rows[0],{code:'ZERO',weight:0}],fetchedAt:'new'};
 assert.equal(forecastHoldingsChanged(forecast,holding),false);
 assert.equal(forecastHoldingsChanged(forecast,{...holding,rows:rows.map(({code,weight})=>({code,weight}))}),false);
 assert.equal(forecastHoldingsChanged(forecast,{...holding,asOf:'2026-10-01'}),true);
 assert.equal(forecastHoldingsChanged(forecast,{...holding,rows:[{...rows[0],weight:21},rows[1]]}),true);
 assert.equal(forecastHoldingsChanged(null,holding),false);
 assert.equal(forecastHoldingsChanged({...forecast,model:{method:'bond-fit-v1'}},holding),false);
});

test('T+1持仓按钮覆盖已封存未公布预估，失败可补算，单只同步与后续日期沿用最新持仓',{timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-holdings-reestimate-'));
 process.env.PORT='0';process.env.QDII_STORAGE='json';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
 const codes=['111111','222222','333333'];
 const row={code:'TEST',name:'测试美股',secid:'105.TEST',currency:'USD',market:'美国',weight:20};
 fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:codes,records:{},lastView:{},
  holdingsSnapshots:Object.fromEntries(codes.map(c=>[c,{asOf:'2026-09-30',rows:[row]}]))}));
 const RealDate=Date,realFetch=globalThis.fetch;
 let clock='2026-10-24T08:00:00+08:00',published=false,nextDay=false,brokenQuotes=false,brokenHoldings=false,price=110,server;
 const weights={111111:20,222222:20,333333:20};
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return RealDate.parse(clock);}};
 globalThis.fetch=async(input,options)=>{
  const url=String(input);if(url.startsWith('http://127.0.0.1:'))return realFetch(input,options);
  if(url.includes('pingzhongdata'))return {ok:true,text:async()=> 'var fS_name = "模拟全球股票基金A";'};
  if(url.includes('FundArchivesDatas')){
   if(brokenHoldings)throw Error('模拟持仓失败');
   const code=new URL(url).searchParams.get('code');
   const html=`<a title='模拟全球股票基金A'>基金</a>截止至：<font>2026-09-30</font><tbody><tr><td>1</td><td><a href='//quote.eastmoney.com/unify/r/105.TEST'>TEST</a></td><td>测试美股</td><td>${weights[code]}%</td></tr></tbody>`;
   return {ok:true,text:async()=> 'var apidata={content:'+JSON.stringify(html)+'};'};
  }
  let value;
  if(url.includes('lsjz')){
   const code=new URL(url).searchParams.get('fundCode');
   const actual=nextDay||published&&code==='333333';
   const rows=[...(actual?[{FSRQ:'2026-10-23',DWJZ:'1.03',JZZZL:'3'}]:[]),{FSRQ:'2026-10-22',DWJZ:'1',JZZZL:'0'},{FSRQ:'2026-10-21',DWJZ:'1',JZZZL:'0'}];
   value={TotalCount:rows.length,Data:{LSJZList:rows}};
  }else if(url.includes('push2his')){
   const fx=url.includes('120.');if(brokenQuotes&&!fx)throw Error('模拟行情失败');
   value={data:{klines:[['2026-10-21',100],['2026-10-22',100],['2026-10-23',price],['2026-10-26',price*1.1]]
    .filter(([d])=>nextDay||d<='2026-10-23').map(([d,c])=>`${d},1,${fx?7:c},1,1,1,1,1,0`)}};
  }else throw Error('未配置的模拟接口 '+url);
  return {ok:true,json:async()=>value,text:async()=>JSON.stringify(value)};
 };
 try{
  ({server}=await import('../server.mjs'));if(!server.listening)await new Promise(r=>server.once('listening',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const get=async(route,body)=>{const response=await realFetch(origin+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
  const pick=(data,code='111111')=>data.items.find(f=>f.code===code);
  const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
  const initial=await get('/api/funds?date=auto');
  const first=pick(initial).record.forecast,firstPublished=pick(initial,'333333').record.forecast;
  assert.equal(pick(initial).date,'2026-10-23');assert.ok(pick(initial).record.sealedAt);near(pick(initial).navEstimate.return,.02);
  weights[111111]=40;weights[333333]=40;published=true;
  const sync=await get('/api/holdings/sync',{date:'auto'});
  near(pick(sync.data).navEstimate.return,.04);near(pick(sync.data).navEstimate.value,1.04);
  near(pick(sync.data,'222222').navEstimate.return,.02);
  assert.deepEqual(pick(sync.data,'333333').record.forecast,firstPublished);assert.equal(pick(sync.data,'333333').record.actual.value,1.03);
  assert.equal(pick(sync.data).record.forecastRevisionReason,'holdings-change');
  const state=loadState(process.env.QDII_DATA_FILE);
  assert.deepEqual(state.records['111111:2026-10-23'].originalForecast,first);
  assert.equal(state.records['111111:2026-10-23'].firstForecastAt,pick(initial).record.firstForecastAt);
  assert.equal(state.records['111111:2026-10-23'].evidence.length,2);
  near(pick(await get('/api/funds?date=auto&cached=1')).navEstimate.return,.04);
  price=120;
  const unchanged=await get('/api/holdings/sync',{date:'auto'});
  assert.equal(unchanged.summary.unchanged,3);near(pick(unchanged.data).navEstimate.return,.04);
  weights[111111]=50;brokenQuotes=true;
  const failed=await get('/api/holdings/sync',{date:'auto'});
  assert.equal(failed.items.find(r=>r.code==='111111').status,'updated');near(pick(failed.data).navEstimate.return,.04);
  assert.equal(pick(failed.data).latestHoldings.rows[0].weight,50);assert.ok(pick(failed.data).modelError);
  brokenQuotes=false;
  const retry=await get('/api/holdings/sync',{date:'auto'});
  assert.equal(retry.summary.unchanged,3);near(pick(retry.data).navEstimate.return,.1);
  weights[111111]=60;
  const single=await get('/api/holdings/sync-one',{code:'111111'});
  assert.equal(single.sync.status,'updated');near(single.item.navEstimate.return,.12);assert.equal(single.item.record.forecast.rows[0].weight,60);
  assert.match(single.sync.calculationMessage,/最新持仓重算/);
  brokenHoldings=true;weights[111111]=70;
  const failedHolding=await get('/api/holdings/sync',{date:'auto'});
  assert.equal(failedHolding.summary.failed,3);near(pick(failedHolding.data).navEstimate.return,.12);
  assert.equal(pick(failedHolding.data).latestHoldings.rows[0].weight,60);
  brokenHoldings=false;nextDay=true;clock='2026-10-27T08:00:00+08:00';
  const future=pick(await get('/api/funds?date=auto'));
  assert.equal(future.date,'2026-10-26');assert.equal(future.record.forecast.rows[0].weight,60);
  near(future.navEstimate.return,.06);near(future.navEstimate.value,1.03*1.06);
  const persisted=loadState(process.env.QDII_DATA_FILE);
  assert.deepEqual(persisted.records['111111:2026-10-23'].originalForecast,first);
  near(persisted.records['111111:2026-10-23'].forecast.model.return,.12);
  assert.deepEqual(replaySealedForecasts(persisted,{limit:20}).mismatches,[]);
 }finally{if(server)await new Promise(r=>server.close(r));globalThis.Date=RealDate;globalThis.fetch=realFetch;}
});
