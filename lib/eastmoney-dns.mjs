import https from 'node:https';
import {isIPv4} from 'node:net';

const supportedHosts=new Set(['fundmobapi.eastmoney.com','fund.eastmoney.com']);
const resolverUrl='https://223.5.5.5/resolve';
const dnsCache=new WeakMap();

export function networkErrorCodes(error){
 return [error?.cause?.code??error?.code,...(error?.cause?.errors??[]).map(cause=>cause.code)].filter(Boolean);
}

export function dnsErrorCode(error){
 return networkErrorCodes(error).find(code=>code==='ENOTFOUND'||code==='EAI_AGAIN');
}

function resolveAddresses(fetcher,hostname){
 let cache=dnsCache.get(fetcher);
 if(!cache){cache=new Map();dnsCache.set(fetcher,cache);}
 const cached=cache.get(hostname);
 if(cached&&Date.now()<cached.expiresAt)return cached.task;

 const entry={expiresAt:Infinity};
 entry.task=(async()=>{
  // The resolver uses a bootstrap IP so its own name needs no system lookup.
  const url=resolverUrl+'?'+new URLSearchParams({name:hostname,type:'A'});
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw new Error('HTTP '+response.status);
  const result=await response.json();
  if(result?.Status!==0||!Array.isArray(result.Answer))throw new Error('未返回 DNS 应答');
  const records=result.Answer.filter(record=>record?.type===1&&typeof record.data==='string'&&isIPv4(record.data));
  if(!records.length)throw new Error('未返回 IPv4 地址');
  const lifetime=Math.min(300,...result.Answer.map(record=>Number.isFinite(record?.TTL)?Math.max(0,record.TTL):0));
  entry.expiresAt=Date.now()+lifetime*1000;
  return [...new Set(records.map(record=>record.data))].map(address=>({address,family:4}));
 })().catch(error=>{cache.delete(hostname);throw error;});
 cache.set(hostname,entry);
 return entry.task;
}

function fetchResolved(url,options,addresses){
 return new Promise((resolve,reject)=>{
  const lookup=(_hostname,{all},callback)=>{
   if(all)callback(null,addresses);
   else callback(null,addresses[0].address,4);
  };
  // Change only the socket addresses. The original name still sets Host, SNI and certificate verification.
  const request=https.get(new URL(url),{headers:options.headers,signal:options.signal,rejectUnauthorized:true,lookup},async response=>{
   try{
    const chunks=[];
    for await(const chunk of response)chunks.push(chunk);
    resolve(new Response(chunks.length?Buffer.concat(chunks):null,{status:response.statusCode}));
   }catch(error){reject(error);}
  });
  request.on('error',reject);
 });
}

export async function fetchWithEastmoneyDns(fetcher,url,options){
 try{return await fetcher(url,options);}
 catch(error){
  const hostname=new URL(url).hostname;
  const code=dnsErrorCode(error);
  if(!code||!supportedHosts.has(hostname))throw error;
  let addresses;
  try{addresses=await resolveAddresses(fetcher,hostname);}
  catch(cause){throw new Error('域名解析失败（'+code+'），HTTPS DNS 查询失败：'+cause.message,{cause});}
  return fetchResolved(url,options,addresses);
 }
}
