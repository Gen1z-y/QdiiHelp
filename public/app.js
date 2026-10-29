import {requestJson,readLines,mountOperations} from './request.js?v=20261015-remove-tools';
import {reliability,reliabilityPanel} from './forecast-details.js?v=20261029-bond-v2';
import {pageRows,pagination,holdingsResultRow,holdingsReadState,holdingsComparison,holdingsAnnouncementLinks,holdingsDateSummary,holdingsUpdatedFunds} from './holdings-ui.js?v=20261027-holdings-actions';
import {drawHolidayExport} from './holiday-export.js';
import {forecastChart,detailHistoryChart} from './forecast-chart.js?v=20261022-period';
import {forecastInputs,fundFxImpact,accuracyPanel,contributionPanel,indexContributionRows,quoteStatusBadge,dateStatus,navPeriodLabel,estimateLabel,intervalNote,observationPanel} from './forecast-details.js?v=20261029-bond-v2';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,d=4)=>Number.isFinite(v)?v.toFixed(d):'—';
const pct=v=>Number.isFinite(v)?`${v>0?'+':''}${(v*100).toFixed(2)}%`:'—';
const color=v=>v>0?'up':v<0?'down':'';
const inFundGroup=(f,group)=>group==='bond'?!!f.bond:(f.group??'watch')===group;
const fundTypeClass=f=>f.bond?'bondcard':f.index||f.indexQuote?'indexcard':'stockcard';
const time=s=>s?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
let items=[],selected=null,busy=false,activeDate='',sequence=0,holdingsBusy=false,forceRefreshing=false;
const comparing=new Set();
let sorting=false;
let activeFundGroup='held';
let contributionMode='cumulative',quoteFilter='all',detailDays=90,detailChartMode='periodic';
const detailHistories=new Map(),detailRequests=new Map();
async function loadDetailHistory(code,validation=false){
 const token={};detailRequests.set(code,token);
 try{const h=await requestJson('/api/history?format=detail&codes='+code+(validation?'&validation=1':''),{},600000);if(detailRequests.get(code)!==token)return;h.validationLoaded=validation;detailHistories.set(code,h);queueCardUpdate(code);if(selected===code)renderDetail(items.find(f=>f.code===code));}
 catch(e){if(selected===code&&detailRequests.get(code)===token){const panel=$('#detail').querySelector('[data-dtabpanel="'+detailTab+'"]');if(panel)panel.insertAdjacentHTML('beforeend','<p class="note">历史数据更新失败：'+esc(e.message)+'</p>');}}
}
let contributionPage=1,holdingsPage=1,holdingsReport=null,holdingsQuery='',holdingsUpdatedOnly=false;
const holdingsRead=holdingsReadState({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)});
document.querySelector('footer p:nth-child(2)').textContent='预估仅供参考，以基金公司公布为准。只计算有数据的持仓，未单独扣除费用；持仓资料超过190天时暂停预估。点击“刷新数据”获取最新结果，不会自动刷新。';
async function api(url,options={}) {
  return requestJson(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});
}
function notice(text){$('#notice').textContent=text;$('#notice').hidden=!text;}
function loadingProgress(p){
 const bar=$('#fundProgress'),label=$('#fundProgressText');$('#fundLoading').hidden=false;
 if(p.total===null){bar.removeAttribute('value');label.textContent='正在准备获取基金信息…';return;}
 bar.max=p.total||1;bar.value=p.completed;
 label.textContent=`获取基金信息：${p.completed} / ${p.total} 只 · ${p.total?Math.floor(p.completed/p.total*100):100}%${p.code?' · '+p.code+' '+p.name:''}${p.stage?' · '+p.stage:''}`;
 if($('#holdingsDialog').open&&forceRefreshing)$('#recalculateStatus').textContent=label.textContent;
}
const historySyncLabel=document.createElement('span');historySyncLabel.className='sr';historySyncLabel.setAttribute('role','status');$('#refresh').after(historySyncLabel);historySyncLabel.id='historySyncStatus';$('#refresh').setAttribute('aria-describedby',historySyncLabel.id);
function renderFxBar(fx,updating=false){
 const block=$('#fxBlock');
 if(!fx){block.hidden=!updating;if(updating){$('#fxLabel').textContent='美元/人民币';$('#fxValue').textContent='更新中…';$('#fxValue').className='';$('#fxNote').textContent='汇率参考';}return;}
 block.hidden=false;
 if(fx.error){$('#fxLabel').textContent='美元/人民币';const v=$('#fxValue');v.textContent='暂不可用';v.className='';$('#fxNote').textContent=fx.error;return;}
 $('#fxLabel').textContent=(fx.date?fx.date+' · ':'')+'美元/人民币';
 const v=$('#fxValue');v.textContent=pct(fx.dailyReturn);v.className=color(fx.dailyReturn);
 const cd=fx.closeDate??'';
 $('#fxNote').title=(fx.source??'参考汇率')+' · '+cd+'；汇率涨跌不等于基金涨跌';
 $('#fxNote').textContent='1美元 = '+num(fx.close,4)+'元 · 仅作参考'+(fx.carried?' · 沿用':'')+(updating?' · 更新中':'');
}
function setHistorySyncStatus(state,text){
 historySyncLabel.textContent=text;$('#refresh').title=text;
}
async function watchHistorySync(seq,date,startedAt=Date.now()){
 if(seq!==sequence)return;
 if(Date.now()-startedAt>=600000){setHistorySyncStatus('warning','历史同步等待超过10分钟，已停止轮询；后台可能仍在继续，可稍后刷新查看');return;}
 try{
  const state=await api('/api/history-sync');if(seq!==sequence)return;
  if(Object.hasOwn(state,'fx'))renderFxBar(state.fx,state.fxUpdating);
  setHistorySyncStatus(state.running?'syncing':state.errors.length?'warning':'complete',state.running?`历史净值后台同步：${state.completed} / ${state.total} 只，当前预估已可查看`:state.errors.length?'历史净值部分同步失败，已保留缓存：'+state.errors.join('；'):'历史净值同步完成');
  if(state.running||state.fxUpdating){setTimeout(()=>watchHistorySync(seq,date,startedAt),1500);return;}
  const saved=await api('/api/funds?cached=1&date='+encodeURIComponent(date));if(seq!==sequence)return;
  for(const item of items){const fresh=saved.items.find(f=>f.code===item.code&&f.date===item.date);if(fresh){item.history=fresh.history;item.stats=fresh.stats;detailHistories.delete(item.code);detailRequests.delete(item.code);}}
  render();if(selected)void loadDetailHistory(selected,detailTab==='accuracy');
 }catch(e){if(seq===sequence)setHistorySyncStatus('warning','历史同步状态暂不可用：'+e.message);}
}
async function fundStream(date,force,seq,holdingsSync=false,group=null){
 let result;
 const consume=line=>{if(!line.trim())return;const event=JSON.parse(line);if(event.type==='error')throw new Error(event.error);if(event.type==='progress'){if(holdingsSync){const bar=$('#holdingsProgress');if(event.total===null)bar.removeAttribute('value');else{bar.max=event.total||1;bar.value=event.completed;}$('#holdingsProgressText').textContent=`${event.phase==='recalculate'?'正在重新估算':'正在获取持仓'}：${event.completed} / ${event.total??'…'} 只${event.code?' · '+event.code+' '+event.name:''}${event.stage?' · '+event.stage:''}`;}else if(seq===sequence)loadingProgress(event);}if(!holdingsSync&&seq===sequence){if(event.type==='snapshot'&&!group&&event.data.items.length){items=event.data.items;activeDate=date;render();$('#status').textContent='已显示本机保存的结果，正在更新行情…';}if(event.type==='progress'&&event.item){const found=items.findIndex(f=>f.code===event.item.code);if(found>=0)items[found]=event.item;else items.push(event.item);queueCardUpdate(event.item.code);}}if(event.type==='progress'&&event.official&&seq===sequence){const p=event.official,found=items.findIndex(f=>f.code===p.code),old=found>=0?items[found]:null;const same=old?.date===p.date;const next={...(same?old:{}),code:p.code,name:p.name,bond:p.bond,index:p.index,group:p.group,date:p.date,record:{...(same?old?.record:{}),...(p.actual?{actual:p.actual}:{})},latestNav:p.latestNav,refreshing:true};if(found>=0)items[found]=next;else items.push(next);queueCardUpdate(p.code);}if(event.type==='result')result=event.data;};
 await readLines(holdingsSync?'/api/holdings/sync':force?'/api/recalculate':'/api/funds?stream=1&date='+encodeURIComponent(date)+(group?'&group='+encodeURIComponent(group):''),force||holdingsSync?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,stream:true})}:{},consume);
 if(!result)throw new Error('数据连接中断，请重新刷新');return result;
}
function fundMatches(f,query){return !query||f.code.includes(query)||f.name.toLowerCase().includes(query);}
let sortMode='manual';
try{sortMode=localStorage.getItem('qdii-sort')||'manual';}catch{}
const sorters={
 estimate:(a,b)=>(b.navEstimate?.return??-Infinity)-(a.navEstimate?.return??-Infinity),
 coverage:(a,b)=>((forecastInputs(b)?.model?.coverage??-1)-(forecastInputs(a)?.model?.coverage??-1)),
 pending:(a,b)=>(Number(!hasPublishedReturn(b.record?.actual))-Number(!hasPublishedReturn(a.record?.actual)))||((b.navEstimate?.return??-Infinity)-(a.navEstimate?.return??-Infinity))
};
$('#fundSearch').oninput=()=>{
 const query=$('#fundSearch').value.trim().toLowerCase();
 const matches=items.filter(f=>fundMatches(f,query));
 if(matches.length&&!matches.some(f=>activeFundGroup==='bond'?f.bond:(f.group??'watch')===activeFundGroup))activeFundGroup=matches[0].group??'watch';
 render();
};
const fundSortSelect=$('#fundSort');
if(fundSortSelect){fundSortSelect.value=sortMode;fundSortSelect.onchange=e=>{sortMode=e.target.value;try{localStorage.setItem('qdii-sort',sortMode);}catch{}render();};}
let seenMap={};try{seenMap=JSON.parse(localStorage.getItem('qdii-seen')||'{}');}catch{}
const cardReadKey=(f,group)=>group+':'+f.code;
const cardSeen=(f,group)=>seenMap[cardReadKey(f,group)]??seenMap[f.code];

function bondReferenceState(f,now=new Date()){
 const r=f.bondReference;
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 const today=`${p.year}-${p.month}-${p.day}`,minutes=Number(p.hour)*60+Number(p.minute);
 let message=f.date>today?'尚未到目标交易日':f.domesticClosure||[0,6].includes(new Date(f.date+'T12:00:00Z').getUTCDay())?'国内休市':f.date===today&&minutes<570?'国内市场未开盘':r?.unavailable;
 const current=!message&&Number.isFinite(r?.return)&&!r.carried&&r.indexDate===f.date&&['000012','000013','000832'].every(symbol=>r.factors?.some(x=>x.symbol===symbol&&x.date===f.date&&!x.carried&&Number.isFinite(x.dayReturn)));
 return {return:current?r.return:null,label:current?(f.date===today&&minutes<900?'盘中参考':'指数拟合参考'):(message??'等待指数行情'),message:current?'指数拟合参考 · 等待收盘 / 公布':(message??'等待目标日债券指数行情')};
}
function hasPublishedReturn(row){
 return !!row&&Number.isFinite(row.value)&&row.value>0&&(Number.isFinite(row.dailyReturn)||Number.isFinite(row.intervalReturn));
}
function navReturnValue(row){return Number.isFinite(row?.dailyReturn)?row.dailyReturn:row?.intervalReturn;}
function latestPublication(f){
 return [f.latestNav,f.record?.actual].filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r?.date??'')&&Number.isFinite(r.value)&&r.value>0)
  .sort((a,b)=>b.date.localeCompare(a.date)||Number(hasPublishedReturn(b))-Number(hasPublishedReturn(a)))[0];
}
function latestPublishedDate(f){
 const row=latestPublication(f);return hasPublishedReturn(row)?row.date:'';
}
function rememberIncomplete(f,state){
 const row=latestPublication(f);
 if(row&&!hasPublishedReturn(row)&&row.date>=(state.actual??'')&&row.date>(state.pendingActual??''))state.pendingActual=row.date;
}
function initializeReadState(funds){
 let changed=false;
 for(const f of funds)for(const group of ['held','watch','bond']){
  if(!inFundGroup(f,group))continue;
  const saved=cardSeen(f,group),next={...saved};
  if(!saved||saved.dotTestUnread&&!saved.actual)next.actual=latestPublishedDate(f);
  delete next.dotTestUnread;rememberIncomplete(f,next);
  if(JSON.stringify(next)!==JSON.stringify(saved)){seenMap[cardReadKey(f,group)]=next;changed=true;}
 }
 if(changed)try{localStorage.setItem('qdii-seen',JSON.stringify(seenMap));}catch{}
}
function unseen(f,group){
 const s=cardSeen(f,group);if(!s)return false;
 const date=latestPublishedDate(f);return !!date&&(date>(s.actual??'')||date===s.pendingActual);
}
function markSeen(f,group){
 if(!f)return;const s={...cardSeen(f,group)},actual=latestPublishedDate(f);
 if(actual>(s.actual??''))s.actual=actual;
 if(actual&&actual>=(s.pendingActual??''))delete s.pendingActual;
 rememberIncomplete(f,s);
 if(f.latestHoldings?.asOf>(s.holdings??''))s.holdings=f.latestHoldings.asOf;
 delete s.dotTestUnread;seenMap[cardReadKey(f,group)]=s;
 try{localStorage.setItem('qdii-seen',JSON.stringify(seenMap));}catch{}
}
function navReturnLabel(row){return !Number.isFinite(row?.dailyReturn)&&Number.isFinite(row?.intervalReturn)&&row.returnPeriod!=='fund-valuation'?'公布区间涨跌':'正式涨跌';}
function navReturnDate(row,date){const to=row?.returnTo??row?.date??date,from=row?.returnFrom??row?.previousDate;return !Number.isFinite(row?.dailyReturn)&&Number.isFinite(row?.intervalReturn)&&from&&from!==to?from+' → '+to:to;}
function navReturnSourceNote(row){return row?.returnSource==='公布净值计算'?'由相邻公布净值计算':row?.returnSource?row.returnSource+' · 同日净值已核对':'';}
function officialReturnTile(f){
 const row=f.record?.actual;
 return '<div class="tile"><small>'+esc(navReturnLabel(row))+' · '+esc(navReturnDate(row,f.date))+'</small><strong class="'+color(navReturnValue(row))+'">'+pct(navReturnValue(row))+'</strong>'+(row?.returnSource?'<small>'+esc(navReturnSourceNote(row))+'</small>':row&&!hasPublishedReturn(row)?'<small>单位净值 '+num(row.value,4)+' · 涨跌幅待补全</small>':'')+'</div>';
}
let detailTab='overview';
function detailTabs(sections){
 const active=sections.some(s=>s.id===detailTab)?detailTab:sections[0].id;
 return `<div class="detailTabs" role="tablist" aria-label="详情分区">${sections.map(s=>`<button data-action="view" type="button" role="tab" data-dtab="${s.id}" aria-selected="${s.id===active}">${s.label}</button>`).join('')}</div>`+sections.map(s=>`<section class="detailTabPanel" data-dtabpanel="${s.id}" ${s.id===active?'':'hidden'}>${s.html}</section>`).join('');
}

function cardState(f){
 const reason=reliability(f);
 if(f.refreshing)return '正在更新预估…';
 if(f.error||f.stale)return f.stale?'刷新异常，保留上次结果':'刷新失败，可重试';
 if(f.record?.actual){
  if(!hasPublishedReturn(f.record.actual))return '净值已公布 · 涨跌幅待补全';
  if(Number.isFinite(f.record.actual.intervalReturn)&&!Number.isFinite(f.record.actual.dailyReturn))return f.record.actual.returnPeriod==='fund-valuation'?f.record.actual.returnReason+'假期后公布 · 较上一公布净值':'公布区间涨跌 · 单日涨跌未公布';
  return f.record.actual.returnSource?'涨跌幅已补全 · '+f.record.actual.returnSource:'正式净值已公布';
 }
 if(f.navEstimate?.partial)return '阶段预估 · 行情截至 '+(f.navEstimate.asOf??'待更新');
 if(f.navEstimate?.referenceOnly)return '区间参考 · 等待正式基准或估值安排确认';
 if(Number.isFinite(f.navEstimate?.return))return '预估已保存 · 等待公布';
 if(f.bond)return bondReferenceState(f).message;
 if(/等待.*收盘|盘中|国内休市|休市.*不生成/.test(f.modelError??''))return '等待收盘 / 公布';
 return reason.attention?'暂不可估算 · 详情查看原因':'等待数据更新';
}
function fundCard(f,index,list,group,query=''){
 const a=f.record?.actual;
 const reference=f.bond?bondReferenceState(f):null;
 const intraday=f.bond&&!Number.isFinite(f.navEstimate?.return)&&!a&&Number.isFinite(reference.return);
 const value=intraday?reference.return:f.navEstimate?.return;
 const disabled=query||sortMode!=='manual'||busy||holdingsBusy;
 return `<article class="fundcard ${fundTypeClass(f)}" data-fund-code="${f.code}" data-card-group="${group}">${unseen(f,group)?'<span class="dot" title="上次查看后有新的公布涨跌结果" aria-label="有新公布结果"></span>':''}<div class="cardhead"><button data-action="view" class="fundbtn" data-select="${f.code}">${esc(f.name)}<small>${f.code} · ${f.bond?'债券基金':f.index||f.indexQuote?'指数基金':'按持仓估算'}</small></button><div class="cardActions"><button data-action="update" data-move="${f.code}" data-move-group="${group}" data-step="-1" data-order-disabled="${!!(query||sortMode!=='manual'||index===0)}" aria-label="上移 ${esc(f.name)}" ${disabled||index===0?'disabled':''}>↑</button><button data-action="update" data-move="${f.code}" data-move-group="${group}" data-step="1" data-order-disabled="${!!(query||sortMode!=='manual'||index===list.length-1)}" aria-label="下移 ${esc(f.name)}" ${disabled||index===list.length-1?'disabled':''}>↓</button><button data-action="delete" class="remove" data-remove="${f.code}">移除</button></div></div><p class="dateStatus">目标净值日 · ${esc(f.date??'—')}${f.navEstimate?.mode==='cumulative'?' · '+esc(navPeriodLabel(f.navEstimate,f.date))+'合计':''}</p><div class="navpair dailyOnly"><div><small>${f.refreshing?'预估更新中':intraday?reference.label:reference&&!a&&!Number.isFinite(f.navEstimate?.return)?reference.label:estimateLabel(f)}</small><span class="estimateValue"><strong class="${color(value)}">${pct(value)}</strong>${calibrationBadge(f,value)}</span></div><div><small>${esc(navReturnLabel(a))} · ${esc(navReturnDate(a,f.date??'—'))}</small><strong class="${color(navReturnValue(a))}">${pct(navReturnValue(a))}</strong>${a?.returnSource?'<small>'+esc(navReturnSourceNote(a))+'</small>':''}</div></div>${f.latestNav?.date&&f.latestNav.date!==f.date?'<p class="muted">最近公布 '+esc(f.latestNav.date)+' · '+pct(navReturnValue(f.latestNav))+'</p>':''}<p class="cardBrief ${f.error?'error':'muted'}" title="${esc(f.error??f.modelError??'')}">${esc(cardState(f))}</p>${intervalNote(f)?'<p class="estimateBasis">'+esc(intervalNote(f))+'</p>':''}${f.pendingPublications?.length?'<p class="pendingCount">待公布 '+f.pendingPublications.length+' 期'+(f.pendingPublications.length>1?' · 详情查看':'')+'</p>':''}</article>`;
}
let cardTimer=null;const pendingCards=new Set();
function queueCardUpdate(code){pendingCards.add(code);if(cardTimer===null)cardTimer=setTimeout(flushCardUpdates,80);}
function cancelCardUpdates(){clearTimeout(cardTimer);cardTimer=null;pendingCards.clear();}
function flushCardUpdates(){
 initializeReadState(items);
 cardTimer=null;const codes=[...pendingCards];pendingCards.clear();
 if(sortMode!=='manual'){render();return;}
 const query=$('#fundSearch').value.trim().toLowerCase();
 for(const code of codes){const f=items.find(f=>f.code===code);if(!f)continue;
  for(const group of ['held','watch','bond']){
   const grid=$('#panel-'+group+' .fundgrid');if(!grid)continue;
   const list=items.filter(f=>inFundGroup(f,group)&&fundMatches(f,query)),index=list.findIndex(f=>f.code===code);
   const old=grid.querySelector('[data-fund-code="'+code+'"]');if(index<0){old?.remove();if(!grid.querySelector('.fundcard')&&!grid.querySelector('.empty'))grid.innerHTML='<p class="empty">未找到符合筛选条件的基金</p>';continue;}
   const template=document.createElement('template');template.innerHTML=fundCard(f,index,list,group,query);const node=template.content.firstElementChild;
   if(old)old.replaceWith(node);else{grid.querySelector('.empty')?.remove();const next=list.slice(index+1).map(f=>grid.querySelector('[data-fund-code="'+f.code+'"]')).find(Boolean);grid.insertBefore(node,next??null);}
  }
 }
 $('#count').textContent=items.length;$('#predicted').textContent=items.filter(f=>Number.isFinite(f.navEstimate?.return)).length;
 const actual=items.filter(f=>hasPublishedReturn(f.record?.actual)),held=actual.filter(f=>f.group==='held').length;$('#published').innerHTML=actual.length+'<small class="metricSub">持有 '+held+' · 自选 '+(actual.length-held)+'</small>';
 for(const group of ['held','watch','bond']){const count=$('#tab-'+group+' span');if(count)count.textContent=items.filter(f=>inFundGroup(f,group)).length;}
 if(selected&&codes.includes(selected))renderDetail(items.find(f=>f.code===selected));
}
function accuracyContent(f){return reliabilityPanel(f)+accuracyPanel(f.stats);}

function render() {
  initializeReadState(items);
  cancelCardUpdates();
  const query=$('#fundSearch').value.trim().toLowerCase();
  const matches=items.filter(f=>fundMatches(f,query));
  $('#fundSearchResults').hidden=!query;
  $('#fundSearchResults').textContent=`找到 ${matches.length} 只基金：持有 ${matches.filter(f=>f.group==='held').length} 只，自选 ${matches.filter(f=>(f.group??'watch')==='watch').length} 只。切换分组查看对应卡片。`;
  $('#count').textContent=items.length;
  const published=items.filter(f=>hasPublishedReturn(f.record?.actual)),pubHeld=published.filter(f=>(f.group??'watch')==='held').length;
  $('#published').innerHTML=published.length+`<small class="metricSub">持有 ${pubHeld} · 自选 ${published.length-pubHeld}</small>`;
  $('#predicted').textContent=items.filter(f=>Number.isFinite(f.navEstimate?.return)).length;
  const groups=[['held','持有','持有基金'],['watch','自选','自选基金'],['bond','债基','债基']];
  const tabs='<div class="fundTabs" role="tablist" aria-label="基金分组">'+groups.map(([group,label])=>`<div class="fundTabItem" role="presentation"><button data-action="view" type="button" role="tab" id="tab-${group}" data-fund-group="${group}" aria-controls="panel-${group}" aria-selected="${activeFundGroup===group}" tabindex="${activeFundGroup===group?0:-1}">${label}<span>${items.filter(f=>inFundGroup(f,group)).length}</span></button><button class="fundGroupRefresh" data-action="update" type="button" data-refresh-group="${group}" title="刷新${label}" aria-label="单独刷新${label}基金" ${busy||holdingsBusy?'disabled':''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 7v5h-5"/><path d="M20 12a8 8 0 1 0-2.3 5.7M20 7l-2.3-2.3"/></svg></button></div>`).join('')+'</div>';
  $('#fundGroupTabs').innerHTML=tabs;
  $('#funds').innerHTML=groups.map(([group,label,noun])=>{
   const groupItems=items.filter(f=>inFundGroup(f,group)&&fundMatches(f,query));
   const list=sortMode==='manual'?groupItems:[...groupItems].sort(sorters[sortMode]??sorters.estimate);
   const cards=list.map((f,index)=>fundCard(f,index,list,group,query)).join('');
   return `<section class="panel fundGroup" role="tabpanel" id="panel-${group}" aria-labelledby="tab-${group}" ${activeFundGroup===group?'':'hidden'}><div class="fundgrid">${cards||'<p class="empty">'+(query?'未找到符合筛选条件的'+noun:'暂无'+noun)+'</p>'}</div></section>`;
  }).join('');
  renderPicker();
  renderDetail(items.find(f=>f.code===selected));
  renderComparison();
}
function renderComparison(){
  const funds=items.filter(f=>comparing.has(f.code)),el=$('#comparison');
  if(funds.length<2){el.innerHTML='<h2>基金对比</h2><p>在上方勾选2–8只基金，对比涨跌、估算质量与共同持仓。已选 '+funds.length+' 只。</p>';return;}
  const metrics=[['预估涨跌',f=>pct(f.navEstimate?.return)],['净值日期',f=>f.date],['预估日期范围',f=>navPeriodLabel(f.navEstimate,f.date)],['基金公司公布涨跌',f=>pct(navReturnValue(f.record?.actual))],['公布比较区间',f=>navReturnDate(f.record?.actual,f.date)],['已用于估算的资产占比',f=>f.bond?'不适用（指数拟合）':(Number.isFinite(forecastInputs(f)?.model?.coverage)?num(forecastInputs(f).model.coverage,2)+'%':'—')],['估算所用持仓日期',f=>forecastInputs(f)?.holdingsDate??'—'],['已对比次数',f=>f.stats?.pairedCount??0],['最近30次平均相差（百分点）',f=>num(f.stats?.mae,2)]];
  const holdings=new Map();
  for(const f of funds)for(const h of f.latestHoldings?.rows??[]){const key=h.secid??h.code;const entry=holdings.get(key)??{name:h.name,code:h.code,weights:{}};entry.weights[f.code]=h.weight;holdings.set(key,entry);}
  const shared=[...holdings.values()].filter(h=>Object.keys(h.weights).length>=2);
  el.innerHTML=`<h2>基金对比 · ${esc('自动日期（各基金以卡片为准）')}</h2><p class="muted">先看日期：只有算的是同一段时间，涨跌才适合直接比较。对比记录少时不排名。</p><div class="tablewrap"><table><thead><tr><th>指标</th>${funds.map(f=>`<th>${esc(f.name)}<br>${f.code}</th>`).join('')}</tr></thead><tbody>${metrics.map(([label,fn])=>`<tr><td>${label}</td>${funds.map(f=>`<td>${esc(fn(f))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><h3>共同重仓股 · ${shared.length} 只</h3><p class="muted">基于各基金最新披露的持仓，不代表全部资产重合程度。</p><div class="tablewrap"><table><thead><tr><th>股票</th>${funds.map(f=>`<th>${f.code} 净资产占比</th>`).join('')}</tr></thead><tbody>${shared.map(h=>`<tr><td>${esc(h.name)} (${esc(h.code)})</td>${funds.map(f=>`<td>${h.weights[f.code]===undefined?'未在披露列表中':num(h.weights[f.code],2)+'%'}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="5">未发现共同披露持仓。</td></tr>'}</tbody></table></div>`;
}
$('#detail').addEventListener('click',e=>{
 const tab=e.target.closest('[data-dtab]');
 if(tab){detailTab=tab.dataset.dtab;if(detailTab==='accuracy'&&selected&&!detailHistories.get(selected)?.validationLoaded)void loadDetailHistory(selected,true);for(const b of $('#detail').querySelectorAll('[data-dtab]'))b.setAttribute('aria-selected',String(b===tab));for(const p of $('#detail').querySelectorAll('[data-dtabpanel]'))p.hidden=p.dataset.dtabpanel!==detailTab;return;}
 const filter=e.target.closest('[data-quote-filter]');if(filter){quoteFilter=filter.dataset.quoteFilter;contributionPage=1;renderDetail(items.find(f=>f.code===selected));return;}
 const historyMode=e.target.closest('[data-history-mode]');if(historyMode){detailChartMode=historyMode.dataset.historyMode;renderDetail(items.find(f=>f.code===selected));return;}
 const range=e.target.closest('[data-detail-days]');if(range){detailDays=Number(range.dataset.detailDays);renderDetail(items.find(f=>f.code===selected));return;}
 const button=e.target.closest('[data-contribution]');if(!button)return;contributionMode=button.dataset.contribution;contributionPage=1;renderDetail(items.find(f=>f.code===selected));$('#detail').querySelector(`[data-contribution="${contributionMode}"]`)?.focus();});
function calibrationInfo(f,shown){
 if(!Number.isFinite(shown))return null;
 const method=f.record?.forecast?.model?.method;
 const stats=detailHistories.get(f.code)?.stats??f.stats;
 const g=(stats?.groups??[]).find(x=>x.method===method);
 const w=g?.windows?.[0];
 if(!w||w.count<10||!Number.isFinite(w.bias)||!Number.isFinite(w.mae))return null;
 return {corrected:shown-w.bias/100,bias:w.bias,mae:w.mae,count:w.count,title:`历史校准参考：预估 ${pct(shown)} − 偏差 ${w.bias>0?'+':''}${w.bias.toFixed(2)}pp；历史平均绝对误差 ${w.mae.toFixed(2)}pp（近 ${w.count} 次）；不是置信区间，不保证本次误差范围`};
}
function calibrationBadge(f,shown){
 const cal=calibrationInfo(f,shown);if(!cal)return '';
 return `<sup class="calTag" title="${esc(cal.title)}">校准 ${pct(cal.corrected)}</sup>`;
}
let syncOneBusy=false;
async function runSyncOne(code){
 const wasHoldingsBusy=holdingsBusy;holdingsBusy=true;
 for(const control of document.querySelectorAll('[data-refresh-group],[data-move]'))control.disabled=true;
 const box=document.createElement('div');box.className='syncOneProgress';
 const label=document.createElement('span');label.setAttribute('role','status');label.setAttribute('aria-live','polite');label.textContent='正在开始同步…';
 const bar=document.createElement('progress');bar.max=1;bar.setAttribute('aria-label','单只基金持仓同步进度');box.append(label,bar);
 const button=$('#holdingsSyncResult').querySelector('[data-sync-one="'+code+'"]');button?.parentElement.append(box);
 const refreshButton=$('#refresh'),syncButton=$('#syncHoldings');const refreshDisabled=refreshButton.disabled,syncDisabled=syncButton.disabled;refreshButton.disabled=true;syncButton.disabled=true;
 try{
  let res;
  await readLines('/api/holdings/sync-one',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,stream:true})},line=>{
   if(!line.trim())return;const event=JSON.parse(line);
   if(event.type==='error')throw new Error(event.error);
   if(event.type==='progress'){label.textContent=event.stage??'正在同步…';if(event.completed===1)bar.value=1;else bar.removeAttribute('value');}
   if(event.type==='result')res=event.data;
  });
  if(!res)throw new Error('同步连接中断，请重试');
  if(res.sync){
   holdingsReport??={items:[],summary:{},serverTime:res.sync.syncedAt};
   for(const row of holdingsReport.items)row.syncedAt??=holdingsReport.serverTime;
   const i=holdingsReport.items.findIndex(r=>r.code===code);
   if(i>=0)holdingsReport.items[i]={...holdingsReport.items[i],...res.sync};else holdingsReport.items.unshift(res.sync);
   holdingsReport.serverTime=res.sync.syncedAt??holdingsReport.serverTime;
   holdingsReport.summary=Object.fromEntries(['updated','unchanged','failed','unsupported'].map(st=>[st,holdingsReport.items.filter(r=>r.status===st).length]));
  }
  if(res.item){detailHistories.delete(code);detailRequests.delete(code);const i=items.findIndex(x=>x.code===code);if(i>=0)items[i]={...items[i],...res.item};else items.push(res.item);}
  render();showHoldingsSync(holdingsReport);
  notice(res.sync?.status==='failed'?'单独同步失败：'+(res.sync.message??'未知原因'):'');
  return res;
 }catch(e){notice(e.message);return null;}
 finally{holdingsBusy=wasHoldingsBusy;for(const control of document.querySelectorAll('[data-refresh-group]'))control.disabled=busy||holdingsBusy;for(const control of document.querySelectorAll('[data-move]'))control.disabled=busy||holdingsBusy||control.dataset.orderDisabled==='true';box.remove();if(button?.isConnected){button.disabled=false;button.textContent='同步';}refreshButton.disabled=refreshDisabled;syncButton.disabled=syncDisabled;}
}
function bondFitPanel(f){
 const fit=f.record?.forecast?.fit,r=f.bondReference,src=fit??r,c=src?.coeffs;
 const v2=f.record?.forecast?.model?.method==='bond-fit-v2'||(!fit&&r?.method==='bond-fit-v2');
 const bp=v=>Number.isFinite(v)?(v*100).toFixed(4)+'%':'—';
 const validation=src?.validation??src?.adaptive?.validation;
 const rows=src&&Array.isArray(c)?[
  ['拟合样本（交易日）',src.samples??'—'],['拟合优度 R²',num(src.r2,2)],['每日残差截距（非额外票息）',bp(c[0])],
  ...(v2?(src.factors??[]).map((fa,i)=>[esc(fa.name)+' 敏感度',num(c[i+1],2)]):[
   ['利率敏感度（国债指数）',num(c[1],2)],['信用敏感度（企债−国债）',num(c[2],2)],['转债敏感度（转债−国债）',num(c[3],2)]]),
  ...(src.factors??[]).map(fa=>[esc(fa.name)+' 单日涨跌',pct(fa.dayReturn)+(fa.carried?'（沿用 '+esc(fa.date)+'）':' · '+esc(fa.date))])
 ]:[];
 const bh=f.bondHoldings,d=src?.disclosure;
 const reason=src?.adaptive?.reason??(!bh?.disclosures?.length?'尚未取得季度券种配置，请在基金持仓中同步；当前沿用原三指数模型':'');
 const explanation=v2?'结合目标日前已公布的季度券种配置，用分期限国债、政策金融债、金融信用债、中票和存单财富指数拟合。按净值占比约束暴露，保留超过100%的债券敞口，以非负岭回归稳定系数，并比较不同滚动窗口。财富指数已含利息，不重复添加票息。':'当前采用原国债、企债、转债三指数拟合；持仓约束候选缺数据或未通过验证时保留原模型。截距包含未被指数解释的平均收益，不能视作单独票息。';
 return '<section><h3>拟合说明 · '+(v2?'持仓约束模型':'原三指数模型')+'</h3><p class="muted">'+explanation+' 样本至少60个且R²不低于0.3；新候选还须通过最近30日逐日验证的总体、近期及较大误差门槛。盘中仅参考，收盘确认后才封存，正式公布后分模型统计。季度持仓有滞后，历史验证不保证未来效果。</p>'+
  (reason?'<p class="note">'+esc(reason)+'</p>':'')+
  (d?'<p class="muted">本次配置依据：'+esc(d.asOf)+' 季报，'+esc(d.publishedAt)+' 公布；债券占净值 '+num(d.categories?.total,2)+'%。</p>':'')+
  (validation?'<p class="muted">选择候选时使用此前 '+num(validation.count,0)+' 个净值日（'+esc(validation.from)+' 至 '+esc(validation.to)+'）：原模型平均误差 '+num(validation.baselineMae*100,4)+'、候选 '+num(validation.candidateMae*100,4)+' 个百分点。这是当前历史数据重建的模型选择结果，不是独立的未来成绩。</p>':'')+
  (rows.length?'<div class="tablewrap"><table><thead><tr><th>项目</th><th>数值</th></tr></thead><tbody>'+rows.map(([k,v])=>'<tr><td>'+k+'</td><td>'+v+'</td></tr>').join('')+'</tbody></table></div>':'<p class="muted">'+esc(r?.unavailable??f.modelError??'暂无拟合结果')+'</p>')+
  (bh?'<h3>披露债券持仓 · '+esc(bh.asOf)+'</h3><p class="muted">前五大债券用于查看组合特征；模型约束来自季度报告的券种配置，不将前五大持仓放大为整个组合。</p>'+(bh.disclosureError?'<p class="note">券种配置补充未完成：'+esc(bh.disclosureError)+'；已保留可用历史配置。</p>':'')+'<div class="tablewrap"><table><thead><tr><th>债券</th><th>占净值比</th></tr></thead><tbody>'+bh.rows.map(x=>'<tr><td>'+esc(x.name)+'<small>'+esc(x.code)+'</small></td><td>'+num(x.weight,2)+'%</td></tr>').join('')+'</tbody></table></div>':'<p class="muted">暂无披露债券持仓。</p>')+
  (f.record?.forecast?.calculatedAt?'<p class="muted">本次预估计算于 '+esc(time(f.record.forecast.calculatedAt))+(f.record?.sealedAt?' · 封存于 '+esc(time(f.record.sealedAt)):'')+'。</p>':'')+'</section>';
}
function detailHistoryPanel(f){
 const history=detailHistories.get(f.code);
 const published=[f.record?.actual,f.latestNav].filter(r=>r?.date&&r.date<=f.date);
 return detailHistoryChart(f.stats?.pairs??[],detailDays,detailChartMode,history?.rows??[],published,f.stages??[])+(history?.stale?'<p class="note">历史下载未完成，当前展示已有缓存：'+esc(history.error)+'</p>':'');
}
function renderDetail(f) {
  if(f&&detailHistories.has(f.code))f={...f,stats:detailHistories.get(f.code).stats};
  const el=$('#detail');if(!f){if($('#detailDialog').open)$('#detailDialog').close();return;}
  if(f.bond){
   const a=f.record?.actual,est=f.navEstimate;
   const reference=bondReferenceState(f);
   const intraday=!Number.isFinite(est?.return)&&!a&&Number.isFinite(reference.return);
   const shownReturn=Number.isFinite(est?.return)?est.return:intraday?reference.return:null;
   const tag=intraday?'<sup class="intradayTag">'+esc(reference.label)+'</sup>':'';
   const status=a?'已公布，可核对':Number.isFinite(est?.return)?(f.record?.sealedAt?'已封存 · 等公布':'收盘后预估'):reference.message;
   const overview=`<div class="detailsummary">
    <div class="tile"><small>${esc(navPeriodLabel(est,f.date))}${est?.mode==='cumulative'?'合计预估':'预估'}${tag}</small><strong class="${color(shownReturn)}">${pct(shownReturn)}</strong>${calibrationBadge(f,shownReturn)}<small>${esc(status)}</small></div>
    ${officialReturnTile(f)}
    <div class="tile"><small>最新公布 · ${esc(f.latestNav?.date??'—')}</small><strong class="${color(navReturnValue(f.latestNav))}">${pct(navReturnValue(f.latestNav))}</strong></div>
   </div>`;
  el.innerHTML=`<div class="dialoghead"><div><h2>${esc(f.name)}</h2><small>${f.code} · 净值日期 ${esc(f.date)}</small></div><button data-action="neutral" id="closeDetail">关闭</button></div>
   ${f.navWarning?'<p class="note">'+esc(f.navWarning)+'</p>':''}
   ${detailTabs([
    {id:'overview',label:'概览',html:overview+observationPanel(f)},
    {id:'chart',label:'涨跌历史',html:detailHistoryPanel(f)},
    {id:'fit',label:'拟合与持仓',html:bondFitPanel(f)},
    {id:'accuracy',label:'准确性',html:accuracyContent(f)}
   ])}`;
   $('#closeDetail').onclick=()=>{selected=null;$('#detailDialog').close();};
   
   return;
  }
  if(f.indexQuote){renderIndexDetail(f);return;}
  const calc=forecastInputs(f),m=calc?.model,rows=calc?.rows??f.latestHoldings?.rows??[];
  const fxTile=valuationFxTile(f);
  const overview=`<div class="detailsummary"><div class="tile"><small>${esc(navPeriodLabel(f.navEstimate,f.date))} · ${esc(estimateLabel(f))}</small><strong class="${color(f.navEstimate?.return)}">${pct(f.navEstimate?.return)}</strong>${calibrationBadge(f,f.navEstimate?.return)}</div>${fxTile}${officialReturnTile(f)}<div class="tile"><small>最新公布 · ${esc(f.latestNav?.date??'—')}</small><strong class="${color(navReturnValue(f.latestNav))}">${pct(navReturnValue(f.latestNav))}</strong></div><div class="tile"><small>已用于估算的资产占比</small><strong>${num(m?.coverage,2)}%</strong></div></div>`;
  el.innerHTML=`<div class="dialoghead"><div><h2>${esc(f.name)}</h2><small>${f.code} · 净值日期 ${f.date}</small></div><button data-action="neutral" id="closeDetail">关闭</button></div>${detailTabs([
    {id:'overview',label:'概览',html:overview+observationPanel(f)},
   {id:'chart',label:'涨跌历史',html:detailHistoryPanel(f)},
   {id:'contrib',label:'持仓贡献',html:contributionPanel(rows,contributionMode,calc?.holdingsDate??f.latestHoldings?.asOf,contributionPage,quoteFilter)},
   {id:'accuracy',label:'准确性',html:accuracyContent(f)}
  ])}
`;
  $('#closeDetail').onclick=()=>{selected=null;$('#detailDialog').close();};
 
  
}
async function refresh(force=false,group=null) {
  force=force===true;
  if(holdingsBusy||busy)return;
  forceRefreshing=force;
  setHistorySyncStatus('syncing','正在刷新收盘数据，等待历史净值同步状态');
  const date='auto';if(!date)return;
  const seq=++sequence;busy=true;$('#refresh').disabled=true;$('#status').textContent=force?'正在重新取行情并计算预估，请稍候…':'获取净值、持仓与收盘行情…';notice('');
  try {
  $('#syncHoldings').disabled=true;for(const button of document.querySelectorAll('[data-refresh-group]'))button.disabled=true;loadingProgress({completed:0,total:null});
  if(activeDate!==date){items=[];selected=null;render();$('#funds').innerHTML='<p class="empty">正在获取所选净值日期的数据…</p>';}
  const data=await fundStream(date,force,seq,false,group);if(seq!==sequence)return;if(group){const updated=new Map(data.items.map(f=>[f.code,f]));items=items.map(f=>updated.get(f.code)??f);for(const f of data.items)if(!items.some(old=>old.code===f.code))items.push(f);}else items=data.items;activeDate=date;detailHistories.clear();detailRequests.clear();render();if(selected)void loadDetailHistory(selected,detailTab==='accuracy');renderFxBar(data.fx,data.fxUpdating);void watchHistorySync(seq,date);$('#status').textContent=force?'重新计算完成 '+time(data.serverTime)+' · 有效预估 '+data.summary.estimated+' 只，实际已公布 '+data.summary.actual+' 只，暂不可估算 '+data.summary.unavailable+' 只':'';if(group)$('#status').textContent=`${{held:'持有',watch:'自选',bond:'债基'}[group]}刷新完成 · ${data.items.length} 只 · ${time(data.serverTime)}`;if(!force){const reused=data.items.filter(f=>f.refreshReused).length;$('#status').textContent+=($('#status').textContent?' · ':'刷新完成 · ')+reused+' 只复用已获取结果，'+(data.items.length-reused)+' 只已检查更新';}const errs=data.items.filter(f=>f.error);if(errs.length)notice(errs.map(f=>f.code+'：'+f.error).join('；'));}
  catch(e){if(seq===sequence){notice('更新失败：'+e.message);$('#status').textContent='刷新失败，稍后重试';setHistorySyncStatus('warning','刷新失败：'+e.message);}}
  finally{if(seq===sequence){$('#fundLoading').hidden=true;busy=false;$('#syncHoldings').disabled=holdingsBusy;$('#refresh').disabled=false;for(const button of document.querySelectorAll('[data-refresh-group]'))button.disabled=holdingsBusy;for(const button of document.querySelectorAll('[data-move]'))button.disabled=holdingsBusy||button.dataset.orderDisabled==='true';}}
}
function showHoldingsSync(report){
 if(report!==holdingsReport){holdingsPage=1;holdingsQuery='';holdingsUpdatedOnly=false;const sb=$('#holdingsSearch');if(sb)sb.value='';}holdingsReport=report;
 if(!report){$('#holdingsSearch').hidden=true;return;}
 if(!report.items.length&&!report.refreshSummary){$('#holdingsSearch').hidden=true;$('#holdingsSyncResult').textContent='暂无可同步的基金';return;}
 const s=report.summary,q=holdingsQuery.trim().toLowerCase();
 if(!report.items.some(r=>r.status==='updated'))holdingsUpdatedOnly=false;
 const filtered=report.items.filter(r=>(!holdingsUpdatedOnly||r.status==='updated')&&(!q||(r.name??'').toLowerCase().includes(q)||(r.code??'').toLowerCase().includes(q)));
 const page=pageRows(filtered,holdingsPage);holdingsPage=page.page;$('#holdingsSearch').hidden=false;
 const resultCount=holdingsUpdatedOnly?filtered.length:report.items.length;
 const summary=[`更新 ${s.updated}`,`无变化 ${s.unchanged}`,s.failed?`失败 ${s.failed}`:'',s.unsupported?`不适用 ${s.unsupported}`:'',report.refreshSummary?`已刷新 ${report.refreshSummary.total} 只`:''].filter(Boolean).join(' · ');
 $('#holdingsSyncResult').innerHTML=`<p class="holdingsSyncSummary"><span>${esc(summary)}</span><time>${esc(time(report.serverTime))}</time></p>${holdingsUpdatedFunds(report.items,holdingsUpdatedOnly)}<details class="holdingsResults" open><summary>同步结果 · ${resultCount} 只${q?`（匹配 ${filtered.length} 只）`:''}</summary><div class="tablewrap"><table class="holdingsSyncTable"><thead><tr><th>基金</th><th>持仓截至日</th><th>持仓数</th><th>最新持仓构成</th><th>本次变化</th></tr></thead><tbody>${page.rows.map(r=>holdingsResultRow(r,report,holdingsRead.unseen(r,report))).join('')||'<tr><td colspan="5">未找到基金</td></tr>'}</tbody></table></div>${pagination(page,'holdings')}<p class="holdingsFootnote">占比为基金净资产比例；“其他”为图中未列部分。</p></details>`;
}
function readHoldingsRow(e){
 const row=e.target.closest('[data-holdings-row]');if(!row||row.contains(e.relatedTarget))return;
 const item=holdingsReport?.items.find(r=>r.code===row.dataset.holdingsRow);if(!item||!holdingsRead.unseen(item,holdingsReport))return;
 holdingsRead.mark(item,holdingsReport);row.querySelector('.holdingsDot')?.remove();
}
$('#holdingsSyncResult').addEventListener('mouseover',readHoldingsRow);
$('#holdingsSyncResult').addEventListener('focusin',readHoldingsRow);
function turnPage(e,scope){
 const button=e.target.closest('[data-page-scope="'+scope+'"]');if(!button||button.disabled)return;
 if(scope==='holdings'){holdingsPage=Number(button.dataset.page);showHoldingsSync(holdingsReport);}
 else{contributionPage=Number(button.dataset.page);renderDetail(items.find(f=>f.code===selected));}
 const container=scope==='holdings'?$('#holdingsSyncResult'):$('#detail');
 const controls=container.querySelector('.holdingsPagination');
 controls?.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
 // Jump to the top of the paged table so the new page starts at its first row.
 controls?.previousElementSibling?.scrollIntoView({block:'start'});
}
$('#holdingsSyncResult').addEventListener('click',async e=>{
 const updatedOnly=e.target.closest('[data-holdings-updated-only]');
 if(updatedOnly){holdingsUpdatedOnly=!holdingsUpdatedOnly;holdingsQuery='';holdingsPage=1;$('#holdingsSearch').value='';showHoldingsSync(holdingsReport);$('#holdingsSyncResult [data-holdings-updated-only]')?.focus({preventScroll:true});return;}
 const jump=e.target.closest('[data-holdings-jump]');
 if(jump){holdingsQuery=jump.dataset.holdingsJump;holdingsPage=1;holdingsUpdatedOnly=false;$('#holdingsSearch').value=holdingsQuery;showHoldingsSync(holdingsReport);const row=$('#holdingsSyncResult [data-holdings-row]');row?.scrollIntoView({block:'nearest'});row?.querySelector('button')?.focus({preventScroll:true});return;}
 const scroll=e.target.closest('[data-holdings-scroll]');
 if(scroll){const viewport=scroll.parentElement.querySelector('.holdingsNameViewport');viewport.scrollBy({left:Number(scroll.dataset.holdingsScroll)*viewport.clientWidth*.8,behavior:'smooth'});return;}
 const changes=e.target.closest('[data-holdings-changes]');
 if(changes){const row=holdingsReport?.items.find(r=>r.code===changes.dataset.holdingsChanges);if(row)openHoldingsChanges(row);return;}
 const one=e.target.closest('[data-sync-one]');
 if(one){if(syncOneBusy||holdingsBusy||busy)return;syncOneBusy=true;one.disabled=true;one.textContent='同步中…';try{await runSyncOne(one.dataset.syncOne);}finally{syncOneBusy=false;}return;}
 turnPage(e,'holdings');
});
let announcementRequest=0;
async function openHoldingsChanges(row){
 const dialog=$('#holdingsChangesDialog'),request=++announcementRequest;
 $('#holdingsChangesTitle').textContent='持仓变化 · '+row.name;
 $('#holdingsChangesMeta').textContent=row.code+' · '+holdingsDateSummary(row);
 $('#holdingsChangesBody').innerHTML=holdingsComparison(row,true);
 $('#holdingsAnnouncementList').href='https://fundf10.eastmoney.com/jjgg_'+encodeURIComponent(row.code)+'_3.html';
 const sources=$('#holdingsAnnouncementSources');sources.textContent='正在查找对应披露期的公告原文…';
 if(!dialog.open)dialog.showModal();
 try{
  const params=new URLSearchParams({code:row.code,date:row.date});if(row.previousDate)params.set('previousDate',row.previousDate);
  const data=await api('/api/holdings/announcements?'+params);
  if(request===announcementRequest&&dialog.open)sources.innerHTML=holdingsAnnouncementLinks(data,row);
 }catch(error){
  if(request!==announcementRequest||!dialog.open)return;
  sources.textContent='公告原文暂时获取失败：'+error.message+'。可重试或打开公告列表。';
  const retry=document.createElement('button');retry.type='button';retry.textContent='重试获取公告';retry.onclick=()=>openHoldingsChanges(row);sources.append(retry);
 }
}
$('#closeHoldingsChanges').onclick=()=>$('#holdingsChangesDialog').close();
$('#holdingsChangesDialog').addEventListener('close',()=>{announcementRequest++;});
$('#holdingsSearch').addEventListener('input',e=>{holdingsQuery=e.target.value;holdingsPage=1;showHoldingsSync(holdingsReport);});
$('#detail').addEventListener('click',e=>turnPage(e,'contribution'));
$('#openHoldings').onclick=()=>{const results=$('#holdingsSyncResult details');if(results)results.open=true;$('#holdingsDialog').showModal();};
$('#closeHoldings').onclick=()=>$('#holdingsDialog').close();
$('#syncHoldings').onclick=async()=>{
 if(busy||holdingsBusy)return;holdingsBusy=true;$('#recalculateStatus').textContent='正在更新披露持仓，随后刷新所有基金估算…';$('#syncHoldings').disabled=true;$('#refresh').disabled=true;$('#holdingsLoading').hidden=false;
 try{const date='auto';const seq=++sequence;const report=await fundStream(date,false,seq,true);showHoldingsSync(report);if(report.data){detailHistories.clear();detailRequests.clear();items=report.data.items.map(f=>({...f,fromSaved:false,refreshComplete:true}));activeDate=date;render();renderFxBar(report.data.fx);}$('#holdingsProgressText').textContent='处理完成，首页已更新';$('#recalculateStatus').textContent='';}
 catch(e){$('#holdingsSyncResult').textContent='同步失败：'+e.message+'；已保存的持仓保留，可重试。';}
 finally{holdingsBusy=false;$('#syncHoldings').disabled=false;$('#refresh').disabled=busy;$('#holdingsLoading').hidden=true;for(const button of document.querySelectorAll('[data-refresh-group]'))button.disabled=busy;for(const button of document.querySelectorAll('[data-move]'))button.disabled=busy||button.dataset.orderDisabled==='true';}
};
api('/api/holdings/sync').then(showHoldingsSync).catch(()=>{});
$('#refresh').onclick=refresh;
$('#addForm').onsubmit=async e=>{e.preventDefault();const btn=e.currentTarget.querySelector('button[type=submit]'),group=$('#addGroup').value;btn.disabled=true;notice('');try{await api('/api/funds',{method:'POST',body:JSON.stringify({code:$('#code').value.trim(),group})});activeFundGroup=group;$('#code').value='';$('#addGroup').value='';$('#fundNamePreview').textContent='';await refresh();document.dispatchEvent(new CustomEvent('fund-selection',{detail:[...comparing]}));}catch(e){notice(e.message);}finally{btn.disabled=false;}};
function switchFundGroup(group){
 if(!['held','watch','bond'].includes(group))return;
 activeFundGroup=group;
 for(const tab of document.querySelectorAll('[data-fund-group]')){const active=tab.dataset.fundGroup===group;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;$('#panel-'+tab.dataset.fundGroup).hidden=!active;}
}
$('#fundGroupTabs').onclick=e=>{const action=e.target.closest('[data-refresh-group]');if(action){void refresh(false,action.dataset.refreshGroup);return;}const tab=e.target.closest('[data-fund-group]');if(tab)switchFundGroup(tab.dataset.fundGroup);};
$('#fundGroupTabs').onkeydown=e=>{
 const tab=e.target.closest('[data-fund-group]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 e.preventDefault();const order=['held','watch','bond'],idx=order.indexOf(activeFundGroup);
 const group=e.key==='Home'?'held':e.key==='End'?'bond':e.key==='ArrowRight'?order[(idx+1)%order.length]:order[(idx+order.length-1)%order.length];
 switchFundGroup(group);$('#tab-'+group).focus();
};
$('#funds').addEventListener('mouseover',e=>{
 const card=e.target.closest('.fundcard');
 if(!card||card.contains(e.relatedTarget))return;
 const dot=card.querySelector('.dot');if(!dot)return;
 const code=card.querySelector('[data-select]')?.dataset.select;
 const fund=items.find(f=>f.code===code);if(!fund)return;
 markSeen(fund,card.dataset.cardGroup);dot.remove();
});
$('#funds').onclick=async e=>{
  const groupTab=e.target.closest('[data-fund-group]');if(groupTab){switchFundGroup(groupTab.dataset.fundGroup);return;}
  const move=e.target.closest('[data-move]');if(move){if(sorting||busy||holdingsBusy||sortMode!=='manual'||$('#fundSearch').value.trim())return;sorting=true;const codes=items.map(f=>f.code),i=codes.indexOf(move.dataset.move),peers=items.filter(f=>inFundGroup(f,move.dataset.moveGroup??activeFundGroup)),at=peers.findIndex(f=>f.code===move.dataset.move),neighbor=peers[at+Number(move.dataset.step)],j=neighbor?codes.indexOf(neighbor.code):-1;try{if(j<0||j>=codes.length)return;[codes[i],codes[j]]=[codes[j],codes[i]];await api('/api/order',{method:'PUT',body:JSON.stringify({codes})});items=codes.map(c=>items.find(f=>f.code===c));render();}catch(e){notice(e.message);}finally{sorting=false;}return;}

  const compare=e.target.closest('[data-compare]');
  if(compare){if(compare.checked){if(comparing.size>=8){compare.checked=false;notice('最多同时对比8只基金');return;}comparing.add(compare.dataset.compare);}else comparing.delete(compare.dataset.compare);renderComparison();document.dispatchEvent(new CustomEvent("fund-selection",{detail:[...comparing]}));return;}
  const del=e.target.closest('[data-remove]'),sel=e.target.closest('[data-select]');
  if(del){del.disabled=true;try{await api('/api/funds/'+del.dataset.remove,{method:'DELETE'});comparing.delete(del.dataset.remove);if(selected===del.dataset.remove)selected=null;await refresh();document.dispatchEvent(new CustomEvent('fund-selection',{detail:[...comparing]}));}catch(e){notice(e.message);del.disabled=false;}}
  else if(sel){selected=sel.dataset.select;contributionPage=1;quoteFilter='all';detailDays=90;detailChartMode='periodic';loadDetailHistory(selected);detailTab='overview';markSeen(items.find(x=>x.code===selected),sel.closest('.fundcard').dataset.cardGroup);render();$('#detailDialog').showModal();}
};

$('#detailDialog').addEventListener('close',()=>{selected=null;});
function renderPicker(){
 const query=$('#compareSearch').value.trim().toLowerCase(),visible=items.filter(f=>fundMatches(f,query));
 $('#compareSearchStatus').textContent='找到 '+visible.length+' 只 · 已选 '+comparing.size+' / 8 只';
 $('#comparePicker').innerHTML=visible.map(f=>`<label class="${fundTypeClass(f)}"><input type="checkbox" data-compare="${f.code}" ${comparing.has(f.code)?'checked':''}> ${esc(f.name)}<small>${f.code} · ${f.group==='held'?'持有':'自选'}</small></label>`).join('')||'<p class="empty">未找到匹配基金，请尝试名称或代码。</p>';
 $('#compareSelected').innerHTML=items.filter(f=>comparing.has(f.code)).map(f=>`<button class="${fundTypeClass(f)}" data-action="view" type="button" data-unselect="${f.code}">已选：${esc(f.name)} ×</button>`).join('');
}
$('#compareSearch').oninput=renderPicker;
$('#compareSelected').onclick=e=>{const button=e.target.closest('[data-unselect]');if(!button)return;comparing.delete(button.dataset.unselect);renderPicker();renderComparison();document.dispatchEvent(new CustomEvent('fund-selection',{detail:[...comparing]}));};
$('#openCompare').onclick=()=>{$('#compareSearch').value='';renderPicker();$('#compareDialog').showModal();};
$('#closeCompare').onclick=()=>$('#compareDialog').close();
$('#comparePicker').onchange=e=>{const target=e.target;if(!target.dataset.compare)return;if(target.checked){if(comparing.size>=8){target.checked=false;$('#compareSearchStatus').textContent='最多同时对比8只基金，请先取消已选基金。';return;}comparing.add(target.dataset.compare);}else comparing.delete(target.dataset.compare);renderPicker();renderComparison();document.dispatchEvent(new CustomEvent('fund-selection',{detail:[...comparing]}));};
let nameTimer,nameSequence=0;
function showFundName(name,code){const existing=items.find(f=>f.code===code);$('#fundNamePreview').textContent=name+(existing?(existing.group==='held'?' · 已在持仓':' · 已在自选'):'');$('#fundNamePreview').title=$('#fundNamePreview').textContent;}
$('#code').addEventListener('input',()=>{clearTimeout(nameTimer);const seq=++nameSequence,code=$('#code').value.trim();$('#fundNamePreview').textContent='';if(!/^\d{6}$/.test(code))return;const existing=items.find(f=>f.code===code);if(existing){showFundName(existing.name,code);return;}$('#fundNamePreview').textContent='查询基金名称…';nameTimer=setTimeout(async()=>{try{const p=await api('/api/fund-profile?code='+code);if(seq===nameSequence)showFundName(p.name,code);}catch(e){if(seq===nameSequence)$('#fundNamePreview').textContent=e.message;}},300);});

try{
 const saved=await api('/api/funds?date=auto&cached=1');
 items=saved.items.map(f=>({...f,refreshComplete:true}));activeDate='auto';render();renderFxBar(saved.fx);
 $('#status').textContent=items.length?'已显示保存的数据，点击“刷新数据”更新':'点击“刷新数据”获取基金数据';
}catch(e){notice('无法读取保存的数据：'+e.message);}finally{$('#fundLoading').hidden=true;}
// Poll saved task state only; never request upstream quotes in the background.
mountOperations({api,onResults:async run=>{
 if(busy||holdingsBusy||sorting)return false;
 if(activeDate&&activeDate!==run.date)return true;
 const saved=await api('/api/funds?cached=1&date='+encodeURIComponent(run.date));
 if(busy||holdingsBusy||sorting)return false;
 items=saved.items.map(f=>({...f,refreshComplete:true}));activeDate=run.date;detailHistories.clear();detailRequests.clear();render();if(selected)void loadDetailHistory(selected,detailTab==='accuracy');renderFxBar(saved.fx);notice(saved.items.filter(f=>f.error).map(f=>f.code+'：'+f.error).join('；'));
 $('#status').textContent=run.source==='tray'?'托盘刷新结果已同步 · '+time(run.finishedAt):'';
 void watchHistorySync(sequence,run.date);return true;
}});


function valuationFxTile(f){
 const impact=fundFxImpact(f),value=impact?.contribution;
 const label='汇率影响（百分点）';
 return '<div class="tile"><small>'+label+'</small><strong class="'+color(value)+'">'+(Number.isFinite(value)?(value>0?'+':'')+num(value*100,2):'—')+'</strong></div>';
}
function fxReferenceNote(f,p){
 if(!f.forecastFxDiffers)return '';
 const fx=p?.fx??p?.rows?.find(r=>r.currency==='USD')?.fx;
 return '<p class="note">已保存预估使用当时的'+esc(fx?.source??'汇率')+'（'+pct(fx?.return)+'）。上方贡献按已保存预估使用的持仓与汇率计算；原预估保留用于历史核对。汇率变动不等于基金实际汇率贡献。</p>';
}
function renderIndexDetail(f){const p=forecastInputs(f),ix=p?.indexQuote??f.indexQuote;
 const overview=`<div class="detailsummary"><div class="tile"><small>${esc(navPeriodLabel(f.navEstimate,f.date))} · ${esc(estimateLabel(f))}（人民币）</small><strong class="${color(f.navEstimate?.return)}">${pct(f.navEstimate?.return)}</strong>${calibrationBadge(f,f.navEstimate?.return)}</div>${valuationFxTile(f)}<div class="tile"><small>${esc(ix.name)}收盘涨跌</small><strong class="${color(ix.dailyReturn)}">${pct(ix.dailyReturn)}</strong><small>${esc(ix.date??'暂无数据')} · 美元</small></div>${officialReturnTile(f)}</div><p>根据这段时间的指数涨跌和汇率变化，估算人民币收益，也包括假期。假设基金全部跟踪该指数。实际持仓、费用等会造成差别，以正式净值为准。${esc(f.modelError??'')}</p>${fxReferenceNote(f,p)}${f.navWarning?'<p class="note">'+esc(f.navWarning)+'</p>':''}<details><summary>查看指数数据和计算方法</summary><p class="muted">${esc(ix.source??'')} · ${quoteStatusBadge(ix)}${ix.date!==f.date?'；指数实际收盘日 '+esc(ix.date)+'，目标日股价沿用，汇率独立计算':''}<br>收盘涨跌 =（${num(ix.close,2)} ÷ ${num(ix.previousClose,2)} − 1）× 100%，前一交易日：${esc(ix.previousDate??'—')}。未收盘时展示最近已完成交易日，并保留原日期。</p></details>`;
  $('#detail').innerHTML=`<div class="dialoghead"><div><h2>${esc(f.name)}</h2><small>${f.code} · 基金净值日期 ${f.date}</small></div><button data-action="neutral" id="closeDetail">关闭</button></div>${detailTabs([
    {id:'overview',label:'概览',html:overview+observationPanel(f)},
   {id:'chart',label:'涨跌历史',html:detailHistoryPanel(f)},
   {id:'contrib',label:'持仓贡献',html:contributionPanel(indexContributionRows(p),contributionMode,"假设全部跟踪该指数",contributionPage,quoteFilter)},
   {id:'accuracy',label:'准确性',html:accuracyContent(f)}
  ])}`;
 $('#closeDetail').onclick=()=>{selected=null;$('#detailDialog').close();};
}



$('#exportImage').onclick=async()=>{
 if(busy||!items.length){notice('请等待基金数据加载完成后再导出');return;}
 const exportItems=items.filter(f=>f.code!=='019305'&&!f.bond&&!f.index&&!f.indexQuote&&!/债|联接|指数/.test(f.name));
 const exportActual=f=>[f.record?.actual,f.latestNav].find(row=>row?.date===(f.navEstimate?.to??f.date)&&Number.isFinite(navReturnValue(row)))??null;
 const actualKey=f=>{const a=exportActual(f);return [a?.returnFrom??a?.previousDate??('unknown-'+f.code),a?.returnTo??a?.date??f.date,'CNY'].join(':');};
 const estimateKey=f=>[f.navEstimate?.from??'unknown',f.navEstimate?.asOf??f.date,'CNY'].join(':');
 const allActualUpdated=exportItems.every(f=>Number.isFinite(navReturnValue(exportActual(f))))&&new Set(exportItems.map(actualKey)).size===1;
 const sameEstimatePeriod=new Set(exportItems.map(estimateKey)).size===1;
 const mixedOfficialPeriods=new Set(exportItems.filter(f=>exportActual(f)).map(actualKey)).size>1;
 const sortReturn=f=>{
  const value=allActualUpdated?navReturnValue(exportActual(f)):f.navEstimate?.return;
  return Number.isFinite(value)?value:-Infinity;
 };
 exportItems.sort((a,b)=>{
  const groupA=allActualUpdated?'':estimateKey(a),groupB=allActualUpdated?'':estimateKey(b);
  if(groupA!==groupB)return groupA.localeCompare(groupB);
  const left=sortReturn(a),right=sortReturn(b);return left===right?0:right-left;
 });
 if(!exportItems.length){notice('没有符合图片导出条件的基金');return;}
 const exportButton=$('#exportImage');if(exportButton.disabled)return;exportButton.disabled=true;
 const progressDialog=document.createElement('dialog');progressDialog.className='exportProgress';progressDialog.setAttribute('aria-label','图片导出提示');
 const progressTitle=document.createElement('h2');progressTitle.textContent='正在导出图片';
 const progressText=document.createElement('p');progressText.setAttribute('role','status');progressText.textContent='正在获取导出图片的指数行情…';
 const progressBar=document.createElement('progress');progressBar.setAttribute('aria-label','图片导出进度');
 const dismiss=document.createElement('button');dismiss.textContent='关闭提示';dismiss.onclick=()=>progressDialog.close();
 progressDialog.append(progressTitle,progressText,progressBar,dismiss);document.body.append(progressDialog);progressDialog.showModal();
 try{
  await document.fonts.ready;
  const holidayData=await api('/api/export-data');
  let canvas;
  if(holidayData.holiday&&!exportItems.some(f=>f.navEstimate?.to)){
   canvas=await drawHolidayExport(holidayData,{api,pct,document});
  }else{
  const windows=[...new Map(exportItems.map(f=>{const w={date:f.navEstimate?.asOf??f.date,...(f.navEstimate?.from?{from:f.navEstimate.from}:{}),target:f.navEstimate?.to??f.date,mode:f.navEstimate?.mode};return [JSON.stringify(w),w];})).values()];
  const marketData=await api('/api/export-indices',{method:'POST',body:JSON.stringify({windows,currency:'CNY'})});
  const marketHeight=windows.length*90+(!sameEstimatePeriod||mixedOfficialPeriods?28:0);
  const tableTop=28+marketHeight,headerHeight=48,rowTop=tableTop+headerHeight;
  canvas=document.createElement('canvas');const scale=2,width=1500,rowHeight=64;
  const height=rowTop+exportItems.length*rowHeight+24;
  canvas.width=width*scale;canvas.height=height*scale;
  const ctx=canvas.getContext('2d');ctx.scale(scale,scale);
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);
  const write=(text,x,y,size=18,fill='#17365e')=>{ctx.font=`${size}px "Microsoft YaHei", sans-serif`;ctx.fillStyle=fill;ctx.fillText(text,x,y);};
  let marketY=24;
  if(!sameEstimatePeriod||mixedOfficialPeriods){write('各基金收益区间不同或未确认，按预估区间分组；公布涨跌不能直接排名',32,marketY,16,'#62748c');marketY+=28;}
  for(const window of windows){
   const quote=marketData.items.find(w=>w.date===window.date&&(w.from??null)===(window.from??null));
   const blockHeight=78,gap=12,leftW=300,tileW=(width-48-leftW-4*gap)/4;
   ctx.fillStyle='#eef4ff';ctx.fillRect(24,marketY,leftW,blockHeight);
   const period=navPeriodLabel({from:window.from,to:window.target,mode:window.mode??(window.from?'cumulative':'daily')});
   write(period+(window.mode==='cumulative'?'合计预估':'预估'),40,marketY+31,22);
   if(window.date<window.target)write('已计入到 '+window.date+' 的行情，尚未算完',40,marketY+58,14,'#62748c');
   ['IXIC','NDX','SPX'].forEach((id,i)=>{
    const x=24+leftW+gap+i*(tileW+gap),q=quote?.indices.find(q=>q.id===id);
    ctx.fillStyle='#eef4ff';ctx.fillRect(x,marketY,tileW,blockHeight);
    write(q?.name??id,x+14,marketY+28,18);
    const cU=q?.usdValue??null,cR=q?.value??null,halfTile=tileW/2;
    write('美',x+14,marketY+58,12,'#62748c');
    write(pct(cU),x+30,marketY+58,20,cU>0?'#bc324b':cU<0?'#278363':'#62748c');
    write('人',x+halfTile+8,marketY+58,12,'#62748c');
    write(pct(cR),x+halfTile+24,marketY+58,20,cR>0?'#bc324b':cR<0?'#278363':'#62748c');
   });
   const fxq=quote?.fx,fxX=24+leftW+gap+3*(tileW+gap);
   ctx.fillStyle='#eef4ff';ctx.fillRect(fxX,marketY,tileW,blockHeight);
   write(fxq?.source==='人民币中间价'?'美元/人民币 · 中间价':'美元/人民币 · 参考',fxX+14,marketY+28,16);
   write(fxq&&Number.isFinite(fxq.value)?pct(fxq.value):'缺汇率',fxX+14,marketY+58,20,fxq&&fxq.value>0?'#bc324b':fxq&&fxq.value<0?'#278363':'#62748c');
   marketY+=blockHeight+12;
  }
  const xs=[32,190,950,1250];
  ctx.fillStyle='#e9eff8';ctx.fillRect(24,tableTop,width-48,headerHeight);
  ['基金代码','基金名称','预估涨跌','公布涨跌'].forEach((v,i)=>write(v,xs[i],tableTop+30));
  exportItems.forEach((f,i)=>{
   const y=rowTop+i*rowHeight,a=exportActual(f);
   ctx.fillStyle=f.bond?'#eef8f2':f.index||f.indexQuote?'#eef4ff':i%2?'#f7f5fa':'#ffffff';ctx.fillRect(24,y,width-48,rowHeight);
   write(f.code,xs[0],y+36);
   ctx.font='18px "Microsoft YaHei", sans-serif';
   let line='',lines=[];for(const ch of f.name){if(ctx.measureText(line+ch).width>550){lines.push(line);line=ch;}else line+=ch;}if(line)lines.push(line);
   lines.slice(0,2).forEach((v,n)=>write(v,xs[1],y+30+n*24));
   const value=f.navEstimate?.return;
   write(Number.isFinite(value)?pct(value):'—',xs[2],y+36,21,value>0?'#bc324b':value<0?'#278363':'#62748c');
   const actualValue=navReturnValue(a);
   write(Number.isFinite(actualValue)?pct(actualValue):'—',xs[3],y+36,21,actualValue>0?'#bc324b':actualValue<0?'#278363':'#62748c');

   if(f.stale||f.error)write('缓存 / 刷新异常',xs[0],y+56,12,'#a45d21');
   if(f.modelError)write(f.modelError.slice(0,46),xs[1],y+rowHeight-5,11,'#a45d21');
  });
  // Single large diagonal watermark above all content, subtle but visible.
  ctx.save();ctx.translate(width/2,height/2);ctx.rotate(-20*Math.PI/180);
  ctx.fillStyle='rgba(23,54,94,0.08)';ctx.font=`700 ${Math.min(96,Math.round(width/14))}px "Microsoft YaHei", sans-serif`;ctx.textAlign='center';
  ctx.fillText('净值观察台 · QDII HELP',0,0);
  ctx.restore();ctx.textAlign='left';
  }
  const url=canvas.toDataURL('image/png'),dialog=document.createElement('dialog');dialog.className='exportPreview';
  const heading=document.createElement('h2');heading.textContent='涨跌图片预览';
  const close=document.createElement('button');close.textContent='关闭';close.setAttribute('data-action','neutral');close.onclick=()=>dialog.close();
  const img=document.createElement('img');img.src=url;img.alt=holidayData.holiday?'国内假期各交易日预估与假期累计列表':'基金交易日期、名称、代码、预估涨跌与实际涨跌列表';
  const download=document.createElement('a');download.href=url;download.download=(holidayData.holiday?'假期预估-':'基金涨跌-')+holidayData.today+'.png';download.textContent='下载 PNG 图片';
  const header=document.createElement('div');header.className='dialoghead';const actions=document.createElement('div');actions.className='previewActions';actions.append(download,close);header.append(heading,actions);
  const content=document.createElement('div');content.className='exportPreviewBody';content.tabIndex=0;content.ariaLabel='涨跌图片，可滚动查看';content.append(img);
  dialog.append(header,content);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);progressDialog.close();progressDialog.remove();dialog.showModal();
 }catch(e){progressTitle.textContent='图片导出失败';progressText.textContent=e.message;progressBar.hidden=true;dismiss.textContent='关闭';progressDialog.addEventListener('close',()=>progressDialog.remove());if(!progressDialog.open)progressDialog.showModal();}finally{exportButton.disabled=false;}
};
