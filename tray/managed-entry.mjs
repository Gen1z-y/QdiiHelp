import readline from 'node:readline';

const emit = value => process.stdout.write('QDII_CONTROL '+JSON.stringify(value)+'\n');
let stopping=false, backend, heartbeat,refreshing;
if(Number(process.versions.node.split('.')[0])<22){console.error('Node.js 22 或以上版本是必需的。');process.exit(1);}
const lines=readline.createInterface({input:process.stdin});
async function stop() {
 if(stopping)return;
 stopping=true;clearInterval(heartbeat);
 emit({type:'stopping'});
 try {
  // A stop can arrive while database initialization is still pending.
  const app=await backend;
  await app.shutdown();
  emit({type:'stopped'});
  lines.close();process.exit(0);
 } catch(error) {
  emit({type:'error',phase:'shutdown',message:'关闭失败：'+error.message});
  // Preserve the process for diagnosis rather than forcing it down after failed writes.
  stopping=false;process.exitCode=1;
 }
}
async function refresh(id){
 if(stopping){emit({type:'refresh-result',id,ok:false,message:'后台正在关闭，请稍后再刷新'});return;}
 if(refreshing){emit({type:'refresh-busy',id});return;}
 const task=(async()=>{
  emit({type:'refresh-started',id});
  try{
   const app=await backend;await app.serverReady;
   const run=await app.refreshFromTray(progress=>emit({type:'refresh-progress',id,completed:progress.completed,total:progress.total}));
   const failed=run.counts?.failed??0,historyFailed=run.historyErrors?.length??0;
   emit({type:'refresh-result',id,ok:true,warning:failed>0||historyFailed>0,runId:run.id,message:'刷新完成：共 '+(run.counts?.total??0)+' 只，已更新 '+(run.counts?.updated??0)+' 只，复用缓存 '+(run.counts?.cached??0)+' 只'+(failed?'；'+failed+' 只刷新异常，请打开页面查看并重试':'')+(historyFailed?'；'+historyFailed+' 只历史净值同步异常':'')+(run.historyPending?'；历史曲线仍在后台同步':'')+(run.counts?.unavailable?'；'+run.counts.unavailable+' 只暂无预估且未公布':'')+'。'});
  }catch(error){emit({type:'refresh-result',id,ok:false,message:'刷新失败：'+error.message});}
 })();refreshing=task;try{await task;}finally{refreshing=null;}
}
lines.on('line',line=>{try{const data=JSON.parse(line);if(data.command==='stop')void stop();else if(data.command==='refresh')void refresh(data.id);}catch{}});
lines.on('close',()=>{if(!stopping)void stop();});
backend=(async()=>{
 if(process.env.QDII_TRAY_FIXTURE==='1')await import('../test/preview-fixture.mjs');
 return import('../server.mjs');
})();
try {
 const app=await backend;
 await app.serverReady;
 if(!stopping){
  emit({type:'ready',pid:process.pid,port:app.server.address().port});
  heartbeat=setInterval(()=>emit({type:'status',busy:app.runtimeStatus().busy}),3000);
 }
} catch(error) {
 emit({type:'error',phase:'startup',message:error.message});
 console.error(error.stack);process.exit(1);
}
