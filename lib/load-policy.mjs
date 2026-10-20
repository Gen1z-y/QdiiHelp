import {holdingsChanged} from './holdings-version.mjs';
import {holdingDateIssue} from './estimation-rules.mjs';
export function canReuseView(view,saved,{force=false,now=Date.now(),ttl=300000}={}){
 if(force||!view||view.error||view.stale)return false;
 // A published target is settled; ordinary refresh only polls unpublished targets.
 if(view.date&&view.record?.actual?.date===view.date&&view.record.actual.value>0)return true;
 if(now-Date.parse(view.checkedAt)>=ttl||!Number.isFinite(Date.parse(view.checkedAt)))return false;
 if(view.indexQuote&&!view.record?.forecast&&!view.record?.actual&&!view.modelError)return false;
 if(!view.index&&!view.bond&&saved&&holdingsChanged(view.latestHoldings,saved))return false;
 if(view.latestHoldings?.fetchedAt&&now-Date.parse(view.latestHoldings.fetchedAt)>=86400000)return false;
 return true;
}
export function blocksStockModel({indexId,nonStock,holdingsDate,date}){
 return Boolean(!indexId&&(nonStock||holdingsDate&&holdingDateIssue(holdingsDate,date)));
}
export function publicView(view){
 const {evidence=[],originalForecast,rejectedForecasts,...record}=view.record??{};
 return {...view,record,evidenceCount:evidence.length,analysis:record.forecast?null:view.analysis,
  latestHoldings:view.latestHoldings?{...view.latestHoldings,rows:view.latestHoldings.rows.filter(r=>r.weight>0),reportedRows:view.latestHoldings.rows.length}:null};
}
