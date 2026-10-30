// Isolated smoke-test service: synthetic funds, mock upstreams, temporary state.
// Run: node test/preview-fixture.mjs (port 8790); never loads data/state.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {estimateMarket,chinaDate,previousWeekday} from '../lib/model.mjs';
import {expectedCloseDate,shiftDate} from '../lib/calendar.mjs';
import {forecastStats} from '../lib/forecast-stats.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-preview-'));
const previewPort=Number(process.env.QDII_PREVIEW_PORT||8790);
if(!Number.isInteger(previewPort)||previewPort<1024||previewPort>65535||previewPort===8787)throw Error('验证端口必须是 1024–65535 内且不同于正式端口 8787 的端口');
process.env.PORT=String(previewPort);process.env.QDII_STORAGE='json';process.env.QDII_DATA_FILE=path.join(dir,'state.json');
const row={code:'TEST',name:'测试股票',secid:'116.TEST',weight:40,currency:'HKD',market:'香港',
 stock:{base:{date:'2026-09-29'},target:{date:'2026-09-30'},return:.1},fx:{base:{date:'2026-09-29'},target:{date:'2026-10-01'},return:.01},
 dailyStock:{base:{date:'2026-09-30'},target:{date:'2026-09-30'},return:0},dailyFx:{base:{date:'2026-09-30'},target:{date:'2026-10-01'},return:.01},
 dailyBaseDate:'2026-09-30',dailyRmbReturn:.01,rmbReturn:.111,marketStatus:{state:'closed',message:'交易所节假日休市',known:true},quoteSource:'测试行情'};
const forecast={date:'2026-10-01',base:{date:'2026-09-29',value:1},holdingsDate:'2026-06-30',rows:[row],model:estimateMarket({value:1},[row]),calculatedAt:'2026-10-02T01:00:00Z'};
// Bond fixture: 110 CN trading days of published NAV paired with the treasury
// index (fund return = 2× index return, so the fit clears the 60-sample/0.3-R²
// gates), plus one sealed bond-fit-v1 forecast already matched by publication.
const bondDates=[];
for(let d=expectedCloseDate(previousWeekday(new Date(chinaDate()+'T12:00:00Z')),'CN');bondDates.length<110;d=expectedCloseDate(shiftDate(d,-1),'CN'))bondDates.unshift(d);
const idxReturn=i=>i===0?0:i%2?-0.0005:0.001;
const bondNav=i=>({FSRQ:bondDates[i],DWJZ:String(1+i*0.001),JZZZL:i===0?'0':i%2?'-0.1':'0.2'});
const idxDates=[...bondDates,chinaDate()];
const kd=bondDates.length-1,tKd=idxReturn(kd);
const fit={coeffs:[0.00005,1.8,0,0],factors:[
 {symbol:'000012',name:'上证国债指数',date:bondDates[kd],dayReturn:tKd,carried:false},
 {symbol:'000013',name:'上证企债指数',date:bondDates[kd],dayReturn:tKd+0.0002,carried:false},
 {symbol:'000832',name:'中证转债指数',date:bondDates[kd],dayReturn:tKd+0.004,carried:false}],samples:105,r2:0.98};
const bondReturn=fit.coeffs[0]+fit.coeffs[1]*tKd,bondBase={date:bondDates[kd-1],value:1+(kd-1)*0.001};
const bondForecast={date:bondDates[kd],base:bondBase,model:{return:bondReturn,dailyReturn:bondReturn,value:bondBase.value*(1+bondReturn),method:'bond-fit-v1'},fit,calculatedAt:bondDates[kd]+'T16:30:00+08:00'};
const records={'123456:2026-10-01':{forecast,firstForecastAt:'2026-10-02T01:00:00.100Z',actual:{date:'2026-10-01',previousDate:'2026-09-29',value:1.04,dailyReturn:.04},firstActualSeenAt:'2026-10-02T03:00:00Z'},
 ['006337:'+bondDates[kd]]:{forecast:bondForecast,sealedAt:bondDates[kd]+'T16:31:00+08:00',firstForecastAt:bondDates[kd]+'T16:31:00.100+08:00',actual:{date:bondDates[kd],previousDate:bondDates[kd-1],value:1+kd*0.001,dailyReturn:kd%2?-0.001:0.002},firstActualSeenAt:bondDates[kd]+'T20:00:00+08:00'}};
// Synthetic sealed bond-fit-v1 pairs (forecast 0.20% vs actual 0.70%) so the
// calibration badge has >=10 samples with a known -0.5pp bias.
const calDates=['2026-04-01','2026-04-02','2026-04-03','2026-04-07','2026-04-08','2026-04-09','2026-04-10','2026-04-13','2026-04-14','2026-04-15','2026-04-16','2026-04-17'];
for(let i=0;i<calDates.length;i++){
 const d=calDates[i],pd=i?calDates[i-1]:'2026-03-31';
 records['006337:'+d]={sealedAt:d+'T16:31:00+08:00',firstForecastAt:d+'T16:31:00.100+08:00',firstActualSeenAt:d+'T20:00:00+08:00',
  forecast:{date:d,base:{date:pd,value:1},model:{return:0.002,dailyReturn:0.002,value:1.002,method:'bond-fit-v1'},fit:{coeffs:[0,2,0,0],factors:[{symbol:'000012',name:'上证国债指数',date:d,dayReturn:0.001,carried:false},{symbol:'000013',name:'上证企债指数',date:d,dayReturn:0.0012,carried:false},{symbol:'000832',name:'中证转债指数',date:d,dayReturn:0.005,carried:false}],samples:100,r2:0.9},calculatedAt:d+'T16:30:00+08:00'},
  actual:{date:d,previousDate:pd,value:1,dailyReturn:0.007}};
}
fs.writeFileSync(process.env.QDII_DATA_FILE,JSON.stringify({version:1,watchlist:['123456','006337'],fundGroups:{'123456':'watch','006337':'held'},records,lastView:{},
 holdingsSnapshots:{'123456':{asOf:'2026-06-30',rows:[{code:'TEST',name:'测试股票',secid:'116.TEST',weight:40,currency:'HKD',market:'香港'}],fetchedAt:'2026-10-01T00:00:00Z',source:'夹具'}},
 bondHoldingsSnapshots:{'006337':{asOf:'2026-06-30',rows:[{code:'260205',name:'26国开05',weight:15.74},{code:'112606096',name:'26交通银行CD096',weight:2.99}],fetchedAt:'2026-10-01T00:00:00Z',source:'夹具'}}}));
globalThis.fetch=async input=>{
 const url=String(input);let result;
 if(url.includes('pingzhongdata'))return {ok:true,text:async()=> url.includes('006337')?'var fS_name = "界面验证债券基金A";':'var fS_name = "界面验证全球股票基金A";'};
 if(url.includes('lsjz')){
  if(url.includes('006337')){
   const u=new URL(url),page=Number(u.searchParams.get('pageIndex')),size=Number(u.searchParams.get('pageSize'));
   const pub=bondDates.map((d,i)=>i).reverse().map(bondNav);
   result={TotalCount:pub.length,Data:{LSJZList:pub.slice((page-1)*size,page*size)}};
  }else result={Data:{LSJZList:[{FSRQ:'2026-10-01',DWJZ:'1.04',JZZZL:'4'},{FSRQ:'2026-09-29',DWJZ:'1',JZZZL:'0'}]}};
 }
 else if(url.includes('type=zqcc')){
  const html="<a title='界面验证债券基金A'>基金</a>截止至：<font class='px12'>2026-09-30</font><tbody><tr><td>1</td><td>260205</td><td>26国开05</td><td>15.74%</td><td>103,892.56</td></tr><tr><td>2</td><td>112606096</td><td>26交通银行CD096</td><td>2.99%</td><td>19,739.41</td></tr></tbody>";
  return {ok:true,text:async()=> 'var apidata={content:'+JSON.stringify(html)+'};'};
 }
 else if(url.includes('FundArchivesDatas')){
  const html="<a title='界面验证全球股票基金A'>基金</a>截止至：<font>2026-06-30</font><tbody><tr><td>1</td><td><a href='//quote.eastmoney.com/unify/r/116.TEST'>TEST</a></td><td>测试股票</td><td>40%</td></tr></tbody>";
  return {ok:true,text:async()=> 'var apidata={content:'+JSON.stringify(html)+'};'};
 }else if(url.includes('ifzq.gtimg.cn')){
  const sym=(url.match(/param=sh(\d{6})/)||[])[1];
  const fn={'000012':idxReturn,'000013':i=>idxReturn(i)+(i%3?0.0002:-0.0003),'000832':i=>idxReturn(i)+[0.004,-0.003,0.002,-0.002,0.001][i%5]}[sym];
  let close=100;
  result={code:0,msg:'',data:{['sh'+sym]:{day:idxDates.map((d,i)=>{close*=1+(i===0?0:fn(i));const c=String(close);return [d,c,c,c,c,'1'];})}}};
 }else if(url.includes('chinamoney.com.cn')){const end=new URL(url).searchParams.get('endDate');result={head:{rep_code:'200'},data:{currency:'USD/CNY'},records:Array.from({length:10},(_,i)=>({date:shiftDate(end,-i),values:[(6.7147+i*0.0018).toFixed(4)]}))};}
 else if(url.includes('push2his'))result={data:{klines:(url.includes('120.')?[['2026-09-29',1],['2026-09-30',1],['2026-10-01',1.01]]:[['2026-09-29',100],['2026-09-30',110]]).map(([d,c])=>`${d},1,${c},1,1,1,1,1,0`)}};
 else throw Error('未配置的测试接口');
 return {ok:true,text:async()=>JSON.stringify(result),json:async()=>result};
};
await import('../server.mjs');
console.log('SMOKE_FIXTURE_READY '+forecastStats('123456',records).pairedCount+' valid sample; bond sealed '+forecastStats('006337',records).pairedCount+' sample');
