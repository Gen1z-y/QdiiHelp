import {setTimeout as delay} from 'node:timers/promises';
import {dnsErrorCode,fetchWithEastmoneyDns,networkErrorCodes} from './eastmoney-dns.mjs';

const navHost='api.fund.eastmoney.com';
const mobileHost='fundmobapi.eastmoney.com';
export const navEndpoint='https://'+navHost+'/f10/lsjz';
const headers={Referer:'https://fundf10.eastmoney.com/','User-Agent':'Mozilla/5.0 QdiiHelp/1.0'};
const retryableCodes=new Set(['EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);
const retryableStatuses=new Set([500,502,503,504,514]);

async function requestNav(host,load){
 for(let attempt=0;;attempt++){
  try{return await load();}
  catch(error){
   const codes=networkErrorCodes(error);
   const transient=retryableStatuses.has(error.status)||codes.some(code=>retryableCodes.has(code))||error.name==='TimeoutError'||(!codes.length&&error.message==='fetch failed');
   if(!attempt&&transient){await delay(500);continue;}
   const timedOut=error.name==='TimeoutError'||codes.some(code=>code==='ETIMEDOUT'||code.endsWith('_TIMEOUT'));
   const reason=dnsErrorCode(error)?'域名解析失败':timedOut?'请求超时':error.message==='fetch failed'?'网络连接失败':error.message;
   const detail=codes.length?'（'+[...new Set(codes)].join('、')+'）':'';
   throw new Error('天天基金净值接口 '+host+' 请求失败：'+reason+detail,{cause:error});
  }
 }
}

function normalizeMobilePage(data){
 const {Datas,TotalCount,Expansion}=data??{};
 const bonus=Expansion?.BonusList;
 if(data?.Success!==true||data.ErrCode!==0||!Array.isArray(Datas)||!Number.isInteger(TotalCount)||TotalCount<Datas.length
    ||Datas.some(row=>!row||!/^\d{4}-\d{2}-\d{2}$/.test(row.FSRQ)||!Number.isFinite(Number(row.DWJZ))||Number(row.DWJZ)<=0)
    ||(bonus!=null&&!Array.isArray(bonus))){
  throw new Error('返回的正式净值格式异常');
 }
 const distribution=new Map();
 for(const event of bonus??[]){
  if(!event?.Remarks)continue;
  const prev=distribution.get(event.FSRQ);
  distribution.set(event.FSRQ,prev?prev+'；'+event.Remarks:event.Remarks);
 }
 return {TotalCount,Data:{LSJZList:Datas.map(row=>({...row,FHSP:distribution.get(row.FSRQ)??row.FHSP}))}};
}

export function createNavPageLoader(fetcher=fetch,decode=response=>response.json()){
 let firstDnsError;
 async function load(url,recoverDns=false){
  const options={headers,signal:AbortSignal.timeout(14000)};
  const response=await (recoverDns?fetchWithEastmoneyDns(fetcher,url,options):fetcher(url,options));
  if(!response.ok)throw Object.assign(new Error('数据源返回 HTTP '+response.status),{status:response.status});
  return decode(response);
 }
 return async url=>{
  const primary=new URL(url);
  const page=primary.searchParams.get('pageIndex');
  if(!firstDnsError){
   try{return await requestNav(navHost,()=>load(url));}
   catch(error){
    // Keep all pages of a history download on the same source.
    if(page!=='1'||!dnsErrorCode(error.cause))throw error;
    firstDnsError=error;
   }
  }
  const mobile=new URL('https://'+mobileHost+'/FundMNewApi/FundMNHisNetList');
  mobile.search=new URLSearchParams({
   FCODE:primary.searchParams.get('fundCode'),pageIndex:page,pageSize:primary.searchParams.get('pageSize'),
   deviceid:'qdiihelp',plat:'Android',product:'EFund',version:'6.5.5',
  }).toString();
  try{return await requestNav(mobileHost,async()=>normalizeMobilePage(await load(mobile.href,true)));}
  catch(error){throw new Error(firstDnsError.message+'；备用'+error.message,{cause:error});}
 };
}
