// Shared updates keep their last stage so later callers can follow the same work.
export async function sharedUpdate(tasks,key,listener,work,{timeoutMs=90000}={}) {
 let task=tasks.get(key);
 if(!task){
  const listeners=new Set();let stage='正在开始更新',expired=false,timer;
  const check=()=>{if(expired)throw new Error('基金更新超时（'+stage+'），已跳过本次更新');};
  const report=value=>{check();stage=value;for(const fn of listeners)fn(value);};
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;try{check();}catch(e){reject(e);}},timeoutMs);});
  task=Promise.race([Promise.resolve().then(()=>work({report,check})),deadline]).finally(()=>{
   clearTimeout(timer);listeners.clear();if(tasks.get(key)===task)tasks.delete(key);
  });
  task.subscribe=fn=>{listeners.add(fn);fn(stage);return ()=>listeners.delete(fn);};
  tasks.set(key,task);
 }
 const unsubscribe=task.subscribe(listener);
 try{return await task;}finally{unsubscribe();}
}
