import {holdingsAnnouncements} from './holdings-announcements.mjs';

const dateOK=s=>/^\d{4}-\d{2}-\d{2}$/.test(s??'');
// Read the category table, not the top-five list. Percentages are of NAV;
// policy banks are a subset of financial bonds and must not be counted twice.
export function parseBondDisclosure(content,{asOf,publishedAt,url}={}){
 if(!dateOK(asOf)||!dateOK(publishedAt)||publishedAt<asOf)throw Error('债券报告日期无效');
 const text=String(content).replace(/\s+/g,' ');
 const part=(a,b)=>{const start=text.search(a);if(start<0)return '';const tail=text.slice(start);const end=tail.search(b);return end>0?tail.slice(0,end):'';};
 const table=part(/5\.4\s*报告期末按债券品种/,/5\.5\s*报告期末/);
 const labels={government:'国家债券',financial:'金融债券',policy:'政策性金融债',corporate:'企业债券',commercialPaper:'企业短期融资券',mtn:'中期票据',convertible:'可转债（可交换债）',cd:'同业存单',other:'其他',total:'合计'};
 const categories={};
 for(const [key,label] of Object.entries(labels)){
  const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=table.match(new RegExp(escaped+'\\s+([\\d,.]+|-)\\s+([\\d.]+|-)'));
  if(!match)throw Error('债券报告缺少券种：'+label);
  categories[key]=match[2]==='-'?0:Number(match[2]);
 }
 const asset=part(/5\.1\s*报告期末基金资产组合/,/5\.2\s*报告期末/);
 const stock=asset.match(/权益投资\s+([\d,.]+|-)\s+([\d.]+|-)/);
 if(!stock)throw Error('债券报告缺少权益配置');
 const stockWeight=stock[2]==='-'?0:Number(stock[2]);
 const sum=Object.entries(categories).filter(([k])=>!['policy','total'].includes(k)).reduce((s,[,v])=>s+v,0);
 if(!Object.values(categories).every(v=>Number.isFinite(v)&&v>=0&&v<=200)||categories.total<=0||Math.abs(sum-categories.total)>.15||categories.policy>categories.financial+.01||!Number.isFinite(stockWeight))throw Error('债券报告配置合计异常');
 return {schema:1,asOf,publishedAt,url,categories,stockWeight,source:'基金季度报告券种配置（占净值比）'};
}

export async function bondDisclosures(code,asOf,{fetcher=fetch}={}){
 const d=new Date(asOf+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-3+1,0);
 const prior=d.toISOString().slice(0,10);
 const list=await holdingsAnnouncements(code,[asOf,prior],{fetcher});
 const result=[];
 for(const period of list.periods){
  // A half-year report shares the June period but uses different table numbers.
  // Select the actual quarterly report, never silently parse another template.
  const report=period.reports.filter(r=>/季/.test(r.title)&&/^\d{4}-\d{2}-\d{2}$/.test(r.publishedAt)).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt))[0];
  if(!report)continue;
  const id=report.url.match(/,(AN\d+)\.html$/)?.[1];if(!id)continue;
  const response=await fetcher('https://np-cnotice-fund.eastmoney.com/api/content/ann?client_source=web_fund&show_all=1&art_code='+id,{signal:AbortSignal.timeout(14000)});
  if(!response.ok)throw Error('债券报告 HTTP '+response.status);
  const data=await response.json();
  if(data.success!==1||typeof data.data?.notice_content!=='string')throw Error('债券报告正文不可用');
  result.push(parseBondDisclosure(data.data.notice_content,{asOf:period.asOf,publishedAt:report.publishedAt,url:report.url}));
 }
 return result;
}

// Publication date must be BEFORE the target day: publication times are not
// supplied, so a same-day report is not assumed known before NAV calculation.
export function disclosureAt(disclosures,target){
 return (disclosures??[]).filter(d=>d.schema===1&&dateOK(d.asOf)&&dateOK(d.publishedAt)&&d.publishedAt<target&&d.asOf<target&&Date.parse(target)-Date.parse(d.asOf)<=190*86400000)
  .sort((a,b)=>b.asOf.localeCompare(a.asOf))[0]??null;
}

export function mergeBondHolding(previous,latest){
 const periods=new Map();
 for(const d of [...(previous?.disclosures??[]),...(latest.disclosures??[])])periods.set(d.asOf+':'+d.publishedAt,d);
 return {...latest,disclosures:[...periods.values()].sort((a,b)=>b.asOf.localeCompare(a.asOf)||b.publishedAt.localeCompare(a.publishedAt)).slice(0,4)};
}
