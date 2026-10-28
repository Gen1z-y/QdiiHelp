import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAllocation,parseHoldings,holdings,clearProviderCache} from '../lib/provider.mjs';
import {captureEvidence,evidenceStats,residualCandidate,modelQuality} from '../lib/model-evidence.mjs';
const forecast=()=>({date:'2026-10-02',base:{date:'2026-09-29',value:1},holdingsDate:'2026-06-30',calculatedAt:'2026-10-03T01:00:00Z',model:{method:'market-close-v4',coverage:40,return:.01,dailyReturn:.005},rows:[{code:'ABC',secid:'105.ABC',weight:40,currency:'USD',rmbReturn:.025}]});
test('asset allocation is parsed without remote execution and missing values remain missing',()=>{
 const text='var Data_assetAllocation = '+JSON.stringify({categories:['2026-03-31','2026-06-30'],series:[{name:'股票占净比',data:[60,80]},{name:'现金占净比',data:[2,null]}]})+';';
 assert.deepEqual(parseAllocation(text),{date:'2026-06-30',stock:80,bond:null,cash:null,source:'天天基金披露资产配置'});
 assert.equal(parseAllocation('var Data_assetAllocation = malicious();'),null);
});
test('full disclosure parser retains all rows from one period and rejects impossible weights',()=>{
 const row=i=>`<tr><td>${i}</td><td>S${i}</td><td>股票</td><td>1.00%</td></tr>`;
 const text=n=>'var apidata={content:'+JSON.stringify('<h4><a title="基金">基金</a>截止至：2026-06-30</h4><table><tbody>'+Array.from({length:n},(_,i)=>row(i)).join('')+'</tbody></table>')+'};';
 assert.equal(parseHoldings(text(89)).rows.length,89);assert.throws(()=>parseHoldings(text(101)),/权重异常/);
});
test('holdings expands only the latest explicitly dated period instead of trusting topline on the default query',async()=>{
 const realFetch=globalThis.fetch,urls=[];
 await clearProviderCache();
 globalThis.fetch=async input=>{const url=String(input);urls.push(url);const expanded=url.includes('year=2026&month=6');const html='<a title="验证基金">验证基金</a>截止至：2026-06-30<table><tbody>'+Array.from({length:expanded?25:10},(_,i)=>`<tr><td>${i}</td><td>S${i}</td><td>股票</td><td>1.00%</td></tr>`).join('')+'</tbody></table>';return {ok:true,text:async()=>'var apidata={content:'+JSON.stringify(html)+'};'};};
 try{const h=await holdings('678901');assert.equal(h.rows.length,25);assert.equal(h.expanded,true);assert.equal(urls.length,2);assert.match(urls[1],/topline=1000&year=2026&month=6/);}
 finally{globalThis.fetch=realFetch;await clearProviderCache();}
});
test('evidence deduplicates inputs, preserves revisions, rejects late or mismatched NAV and counts each model once per date',()=>{
 const r={},f=forecast(),candidate={method:'residual-us-spx-v1',return:.025};
 captureEvidence(r,f,{candidate},'2026-10-03T01:01:00Z');captureEvidence(r,f,{candidate},'2026-10-03T01:02:00Z');assert.equal(r.evidence.length,1);
 f.model.return=.012;captureEvidence(r,f,{candidate},'2026-10-03T01:03:00Z');assert.equal(r.evidence.length,2);assert.equal(r.evidence[0].model.return,.01);
 r.actual={date:'2026-10-02',previousDate:'2026-09-29',dailyReturn:.02};r.firstActualSeenAt='2026-10-04T01:00:00Z';
 const stats=evidenceStats({'123456:2026-10-02':r},'123456');assert.equal(stats.groups.length,2);assert.equal(stats.groups[0].count,1);assert.ok(Math.abs(stats.groups[0].mae-.8)<1e-10);
 captureEvidence(r,f,{},'2026-10-04T02:00:00Z');assert.equal(r.evidence.length,2);
 r.actual.previousDate='2026-09-30';assert.equal(evidenceStats({'123456:2026-10-02':r},'123456').groups.length,0);
 r.actual.previousDate='2026-09-29';r.firstActualSeenAt='2026-10-03T00:00:00Z';assert.equal(evidenceStats({'123456:2026-10-02':r},'123456').groups.length,0);
});
test('持仓重算追加证据兼容数据库不可变快照，保留原数组与原输入',()=>{
 const first={},f=forecast();captureEvidence(first,f,{},'2026-10-03T01:01:00Z');
 const frozen=Object.freeze(first.evidence),next={...first};
 const changed={...f,model:{...f.model,return:.02},rows:[{...f.rows[0],weight:80}]};
 captureEvidence(next,changed,{},'2026-10-03T01:02:00Z');
 assert.equal(first.evidence,frozen);assert.equal(frozen.length,1);assert.equal(next.evidence.length,2);
 assert.equal(next.evidence[0].rows[0].weight,40);assert.equal(next.evidence[1].rows[0].weight,80);
 captureEvidence(next,changed,{},'2026-10-03T01:03:00Z');assert.equal(next.evidence.length,2);
});
test('residual proxy uses known stock allocation and stays experimental, refusing weak or inconsistent data',()=>{
 const f=forecast(),a={date:'2026-06-30',stock:80},q={name:'标普500',date:'2026-10-02',baseClose:100,close:102,valuationPreviousClose:101};
 const c=residualCandidate(f,a,q,{return:0},{return:0});assert.ok(Math.abs(c.return-.018)<1e-10);assert.equal(c.experimental,true);assert.equal(c.missingStockWeight,40);assert.equal(f.model.return,.01);
 assert.equal(residualCandidate(f,{...a,date:'2026-03-31'},q,{return:0},{return:0}),null);
 f.model.coverage=10;assert.equal(residualCandidate(f,a,q,{return:0},{return:0}),null);
 f.model.coverage=40;f.rows[0].currency='HKD';assert.equal(residualCandidate(f,a,q,{return:0},{return:0}),null);
 assert.equal(modelQuality(f,a,new Date('2026-10-03')).level,'存在缺口');
});
