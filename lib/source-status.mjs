// Summarize last observed inputs only; opening diagnostics never calls a quote source.
export function sourceStatus(views){
 const latest=new Map(),sources=new Map();
 for(const view of views){const old=latest.get(view.code);if(!old||(view.checkedAt??'')>(old.checkedAt??''))latest.set(view.code,view);}
 function add(name,{date,error,stale=false}={}){const item=sources.get(name)??{name,inputs:0,errors:0,carried:0,latestDate:null,lastError:null};item.inputs++;if(error){item.errors++;item.lastError=error;}if(stale)item.carried++;if(date&&(!item.latestDate||date>item.latestDate))item.latestDate=date;sources.set(name,item);}
 for(const view of latest.values()){
  add('基金公布净值',{date:view.latestNav?.date,error:view.error??view.navWarning});
  const forecast=view.record?.forecast??view.record?.partialForecast??view.analysis;
  for(const row of forecast?.rows??[]){
   add(row.quoteSource??'股票行情（未标明来源）',{date:row.stock?.target?.date,error:row.error,stale:row.stale});
   if(row.fx)add(row.fx.source??'人民币汇率',{date:row.fx.target?.date,stale:row.fx.target?.date<forecast.date});
  }
  const ix=view.indexQuote;if(ix)add(ix.source??'指数行情',{date:ix.date,error:ix.error,stale:ix.stale});
 }
 return [...sources.values()];
}
