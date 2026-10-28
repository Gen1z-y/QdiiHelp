// Transport failures are counted separately for stock quotes and FX fixings.
// Empty/malformed symbol data must not disable other symbols.
export class QuoteCircuit {
 constructor({threshold=3,cooldownMs=60000,now=Date.now}={}){this.threshold=threshold;this.cooldownMs=cooldownMs;this.now=now;this.states=new Map();}
 clear(){this.states.clear();}
 async run(scope,load){
  let state=this.states.get(scope);
  if(!state){state={failures:0,until:0,probe:false,generation:0};this.states.set(scope,state);}
  if(state.until>this.now()||state.probe)throw Error('东方财富'+(scope==='fx'?'汇率':'股票行情')+'接口暂缓请求，请稍后重试');
  const probing=!!state.until;
  if(probing)state.probe=true;
  const generation=state.generation;
  try{
   const value=await load();
   if(state.generation===generation){state.failures=0;state.until=0;}
   return value;
  }catch(error){
   const transport=error.status===429||error.status>=500||['TimeoutError','AbortError'].includes(error.name)||/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket|network|timed?\s*out/i.test(error.message);
   if(transport&&state.generation===generation&&++state.failures>=this.threshold){state.until=this.now()+this.cooldownMs;state.generation++;}
   throw error;
  }finally{if(probing)state.probe=false;}
 }
}
