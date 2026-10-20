import {randomUUID} from 'node:crypto';

// Reports contain summaries only. Computation continues if a browser disconnects.
export class RefreshTasks {
 constructor({runs=[],work,persist=async()=>{}}){
  this.work=work;this.persist=persist;this.active=new Map();this.reset(runs);
 }
 reset(runs){if(this.active.size)throw Error('仍有刷新任务，不能替换任务记录');this.runs=runs;for(const run of runs)if(run.status==='running'){run.status='interrupted';run.finishedAt=new Date().toISOString();run.error='后台已重启或恢复数据，请重试未完成的刷新';}}
 list(){return this.runs;}
 get(id){return this.runs.find(r=>r.id===id);}
 pending(){return [...this.active.values()].map(t=>t.promise);}
 start(options={},listener=()=>{}){
  const key=JSON.stringify([options.date??'auto',options.group??null,options.codes?[...options.codes].sort():null]);
  let task=this.active.get(key);
  if(task){task.listeners.add(listener);try{listener(task.report.progress);}catch{}return task;}
  if(this.active.size>=4)throw Error('已有多个刷新任务，请等待完成后再试');
  const report={id:randomUUID(),date:options.date??'auto',group:options.group??null,source:options.source??'page',status:'running',startedAt:new Date().toISOString(),progress:{completed:0,total:null},items:[]};
  this.runs.unshift(report);if(this.runs.length>20){const removable=this.runs.filter(r=>r.status!=='running').slice(20-this.runs.filter(r=>r.status==='running').length);for(const r of removable)this.runs.splice(this.runs.indexOf(r),1);}
  task={report,listeners:new Set([listener])};this.active.set(key,task);
  task.promise=Promise.resolve().then(async()=>{
   await this.persist();
   const data=await this.work(options,p=>{
    report.progress={completed:p.completed,total:p.total,code:p.code,name:p.name,stage:p.stage};
    for(const fn of task.listeners){try{fn(p);}catch{}}
   });
   report.items=data.items.map(f=>({code:f.code,name:f.name,date:f.date,status:f.error?(f.stale?'cached':'failed'):f.refreshReused?'cached':'updated',error:f.error??null,warning:f.navWarning??f.modelError??null,estimated:Number.isFinite(f.navEstimate?.return),published:!!f.record?.actual}));
   report.counts={total:report.items.length,updated:report.items.filter(r=>r.status==='updated').length,cached:report.items.filter(r=>r.status==='cached').length,failed:report.items.filter(r=>r.error).length,unavailable:report.items.filter(r=>!r.estimated&&!r.published).length};
   report.status=report.counts.failed?'partial':'complete';report.finishedAt=new Date().toISOString();
   await this.persist();return {...data,refreshTask:report};
  }).catch(async error=>{
   report.status='failed';report.error=error.message;report.finishedAt=new Date().toISOString();
   try{await this.persist();}catch{}
   throw error;
  }).finally(()=>{this.active.delete(key);task.listeners.clear();});
  task.promise.catch(()=>{});return task;
 }
 retry(id,listener=()=>{}){
  const previous=this.get(id);if(!previous)throw Error('刷新记录不存在');
  if(previous.status==='running')throw Error('本次刷新仍在进行');
  const codes=previous.items.filter(r=>r.error).map(r=>r.code);
  if(!codes.length)throw Error('没有需要单独重试的失败项');
  return this.start({date:previous.date,codes,source:'retry'},listener);
 }
}
