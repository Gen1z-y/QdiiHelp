import {readLines} from './request.js';
const opener=document.createElement('button');opener.id='openMarkets';opener.dataset.action='view';opener.innerHTML='<svg class="buttonIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 3v18h18M7 15l4-5 4 3 6-8M17 5h4v4"/></svg><span>全球指数</span>';opener.setAttribute('aria-haspopup','dialog');document.querySelector('#headerActions').prepend(opener);
const dialog=document.querySelector('#marketsDialog');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>Number.isFinite(v)?`${v>0?'+':''}${(v*100).toFixed(2)}%`:'—';
const number=v=>Number.isFinite(v)?v.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const beijing=s=>s?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(s)):'时间暂缺';
let items=[],loading=false;
dialog.innerHTML=`<div class="dialoghead"><div><span class="eyebrow">GLOBAL MARKETS</span><h2 id="marketsTitle">全球指数行情</h2></div><div class="marketHeaderActions"><button data-action="update" id="reloadMarkets" class="dark">刷新行情</button><button data-action="neutral" id="closeMarkets" aria-label="关闭全球指数行情">关闭 ×</button></div></div><div id="marketLoading" hidden><progress id="marketProgress" aria-label="指数加载进度"></progress></div><p id="marketStatus" role="status" aria-live="polite"></p><section class="marketMap" aria-label="指数地图"><svg class="worldSilhouette" viewBox="0 0 1000 420" aria-hidden="true"><defs><pattern id="worldDots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="2" fill="#c9d2e3"/></pattern></defs><path fill="url(#worldDots)" d="M65 85L128 44 237 40 306 66 293 100 254 130 228 166 197 181 211 213 178 199 139 145 94 134Z M242 212L294 221 328 258 304 321 277 378 251 331 231 266Z M327 36L389 18 418 41 381 86 347 73Z M437 96L476 60 520 77 544 113 520 144 476 139Z M468 150L541 144 580 187 559 247 523 299 486 276 465 213 445 177Z M535 71L626 37 751 47 829 65 930 113 907 149 834 167 797 219 755 195 722 149 679 171 649 208 611 164 568 143Z M790 277L860 259 911 288 900 335 839 347 798 322Z M929 337L948 319 956 353 935 376Z"/></svg><div id="marketPins"></div></section><p class="muted">交易时段显示最新报价，收盘后显示最新确认的收盘价；报价可能延迟，以标注时间为准。日期按当地交易日，更新时间按北京时间。涨跌未换算成人民币。数据来自腾讯、新浪、东方财富或百度股市通，地图仅示意位置。</p>`;
function pins(){
 const host=document.querySelector('#marketPins');host.innerHTML='';
 for(const m of items){
  const display=m.display??{quote:m.closing,label:'收盘行情',kind:'closed',pointLabel:'收盘点数'},q=display.quote,b=document.createElement('div');b.className='marketPin';b.style.left=m.x+'%';b.style.top=Math.min(82,m.y)+'%';
  b.innerHTML=`<span class="marketQuoteBadge ${esc(display.kind)}">${esc(display.label)}</span><span>${esc(m.name)}</span><strong class="marketPoints">${number(q?.close)}<small>${esc(display.pointLabel??'')}</small></strong><strong class="${q?.change>0?'up':q?.change<0?'down':''}">${pct(q?.change)}</strong><small>${esc((m.stale?'缓存 · ':'')+(q?.date??'日期暂缺'))}</small>${q?.asOf?'<small>北京时间 '+esc(beijing(q.asOf))+'</small>':''}`;
  host.append(b);
 }
}
async function load(force=false){
 if(loading)return;loading=true;
 const status=document.querySelector('#marketStatus'),refresh=document.querySelector('#reloadMarkets'),loadingBox=document.querySelector('#marketLoading'),bar=document.querySelector('#marketProgress');
 refresh.disabled=true;loadingBox.hidden=false;bar.removeAttribute('value');status.textContent='正在获取全球指数行情…';
 let result;
 try{
  await readLines('/api/global-markets?stream=1'+(force?'&refresh=1':''),{},line=>{
   if(!line.trim())return;const event=JSON.parse(line);
   if(event.type==='error')throw Error(event.error);
   if(event.type==='progress'&&event.total){
    bar.max=event.total;bar.value=event.completed;status.textContent='正在加载指数：'+event.completed+' / '+event.total;
    if(event.item){const i=items.findIndex(m=>m.id===event.item.id);if(i<0)items.push(event.item);else items[i]=event.item;pins();}
   }
   if(event.type==='result')result=event.data;
  });
  if(!result)throw Error('数据传输中断');items=result.items;pins();
  const count=items.filter(s=>s.error).length;
  status.textContent=count?'已完成，'+count+' 个指数未能更新，保留可用数据。':'已加载 '+items.length+' 个指数。点击“刷新行情”获取最新报价。';
 }catch(e){status.textContent='行情加载失败：'+e.message+'，请点击刷新重试。';}
 finally{loading=false;refresh.disabled=false;loadingBox.hidden=true;}
}
document.querySelector('#openMarkets').onclick=()=>{dialog.showModal();load();};
document.querySelector('#closeMarkets').onclick=()=>dialog.close();
document.querySelector('#reloadMarkets').onclick=()=>load(true);
// Load on open or explicit refresh; no periodic page refresh.
