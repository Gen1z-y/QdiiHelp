import {setTimeout as delay} from 'node:timers/promises';

export const navEndpoint='https://api.fund.eastmoney.com/f10/lsjz';

const retryableCodes=new Set(['EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);
const retryableStatuses=new Set([500,502,503,504,514]);

export async function requestNav(load){
 for(let attempt=0;;attempt++){
  try{return await load();}
  catch(error){
   const codes=[error.cause?.code??error.code,...(error.cause?.errors??[]).map(cause=>cause.code)].filter(Boolean);
   const transient=retryableStatuses.has(error.status)||codes.some(code=>retryableCodes.has(code))||error.name==='TimeoutError'||(!codes.length&&error.message==='fetch failed');
   if(!attempt&&transient){await delay(500);continue;}
   const timedOut=error.name==='TimeoutError'||codes.some(code=>code==='ETIMEDOUT'||code.endsWith('_TIMEOUT'));
   const reason=codes.includes('ENOTFOUND')||codes.includes('EAI_AGAIN')?'域名解析失败':timedOut?'请求超时':error.message==='fetch failed'?'网络连接失败':error.message;
   const detail=codes.length?`（${[...new Set(codes)].join('、')}）`:'';
   throw new Error(`天天基金净值接口 api.fund.eastmoney.com 请求失败：${reason}${detail}`,{cause:error});
  }
 }
}
