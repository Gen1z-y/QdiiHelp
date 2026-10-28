const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function holdingsReadState(storage){
 let seen={};try{const value=JSON.parse(storage.getItem('qdii-holdings-seen')||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))seen=value;}catch{}
 const key=(row,report)=>row.syncedAt||report?.serverTime||JSON.stringify([row.date,row.holdings]);
 return {unseen:(row,report)=>row.status==='updated'&&seen[row.code]!==key(row,report),mark(row,report){seen[row.code]=key(row,report);try{storage.setItem('qdii-holdings-seen',JSON.stringify(seen));}catch{}}};
}
export function holdingChanges(previous,current){
 if(!previous?.rows?.length||!current?.rows?.length)return null;
 // Prefer codes; use exchange IDs only when a code occurs on multiple markets.
 const markets=new Map();
 for(const r of [...previous.rows,...current.rows])if(r.code&&r.secid){const set=markets.get(r.code)||new Set();set.add(r.secid);markets.set(r.code,set);}
 const key=r=>r.code?(markets.get(r.code)?.size>1?(r.secid||r.code):r.code):(r.secid||r.name);
 const before=new Map(previous.rows.map(r=>[key(r),r])),after=new Map(current.rows.map(r=>[key(r),r]));
 const changes=[];
 for(const id of new Set([...before.keys(),...after.keys()])){
  const a=before.get(id),b=after.get(id),oldWeight=Number.isFinite(a?.weight)?a.weight:null,newWeight=Number.isFinite(b?.weight)?b.weight:null;
  const delta=oldWeight!==null&&newWeight!==null?Math.round((newWeight-oldWeight)*10000)/10000:null;
  const kind=!a?'added':!b?'removed':delta===null?'unknown':delta>0?'increased':delta<0?'decreased':'unchanged';
  if(kind!=='unchanged')changes.push({name:b?.name||a?.name||b?.code||a?.code,code:b?.code||a?.code,oldWeight,newWeight,delta,kind});
 }
 return changes.sort((a,b)=>Math.abs(b.delta??b.newWeight??b.oldWeight??0)-Math.abs(a.delta??a.newWeight??a.oldWeight??0));
}
export function holdingsComparison(row,expanded=false){
 if(row.status==='failed'||row.status==='unsupported')return '';
 const changes=holdingChanges(row.previousHoldings,row.holdings);
 if(changes===null)return '<small class="muted">'+(row.previousDate?'未保存旧明细，后续同步可对比':'首次同步，已建立持仓基线')+'</small>';
 if(!changes.length)return '<small class="muted">'+(row.previousDate!==row.date?'持仓截至日更新，占比未变':'持仓未变')+'</small>';
 if(!expanded)return '<button type="button" data-action="view" class="holdingsChangesButton" data-holdings-changes="'+esc(row.code)+'" aria-haspopup="dialog" aria-controls="holdingsChangesDialog">持仓变化 · '+changes.length+' 项</button>';
 const labels={added:'新出现',removed:'不再披露',increased:'占比增加',decreased:'占比减少',unknown:'占比待确认'};
 const counts=['added','removed','increased','decreased','unknown'].map(kind=>{const n=changes.filter(r=>r.kind===kind).length;return n?labels[kind]+' '+n:'';}).filter(Boolean).join(' · ');
 const weight=n=>n===null?'—':n.toFixed(2)+'%';
 return '<section class="holdingsChanges"><h3>持仓变化 · '+changes.length+' 项</h3><p class="holdingsChangeCounts">'+counts+'</p><div class="holdingsChangeScroll" tabindex="0" role="region" aria-label="新旧披露持仓对比"><table class="holdingsChangeTable"><thead><tr><th>持仓</th><th>原占比</th><th>新占比</th><th>变化<small>百分点</small></th></tr></thead><tbody>'+changes.map(r=>'<tr><td title="'+esc(r.code)+'">'+esc(r.name)+'</td><td>'+weight(r.oldWeight)+'</td><td>'+weight(r.newWeight)+'</td><td class="'+(r.delta>0?'up':r.delta<0?'down':'')+'">'+(r.kind==='increased'||r.kind==='decreased'?(r.delta>0?'+':'')+r.delta.toFixed(2):labels[r.kind])+'</td></tr>').join('')+'</tbody></table></div><small class="muted">仅比较披露明细；新出现或不再披露不代表实际买入或清仓。</small></section>';
}
export function holdingsAnnouncementLinks(data,row){
 const periods=(row.date===row.previousDate?[['持仓截至',row.date]]:[['新持仓截至',row.date],['上期持仓截至',row.previousDate]]).filter(([,date])=>date);
 return periods.map(([label,date])=>{
  const reports=data.periods?.find(p=>p.asOf===date)?.reports??[];
  return '<section class="holdingsAnnouncementPeriod"><h4>'+label+' · '+esc(date)+'</h4>'+(reports.length?reports.map(r=>'<p><a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+esc(r.title)+' ↗</a><small>公告日期 '+esc(r.publishedAt||'—')+'</small><a class="holdingsSourceAddress" href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">'+esc(r.url)+'</a></p>').join(''):'<p class="muted">未匹配到该披露期的报告，请到下方公告列表核对。</p>')+'</section>';
 }).join('');
}
export function holdingsUpdatedFunds(rows,onlyUpdated=false){
 const updated=rows.filter(r=>r.status==='updated');
 if(!updated.length)return '';
 return '<section class="holdingsUpdates" aria-label="本次更新的基金"><strong>本次更新 '+updated.length+' 只</strong><div class="holdingsUpdatedNames">'+updated.map(r=>'<button type="button" data-action="view" data-holdings-jump="'+esc(r.code)+'" title="点击定位 · 持仓截至 '+esc(r.date??'—')+'">'+esc(r.name||r.code)+'<small>'+esc(r.code)+'</small></button>').join('')+'</div><button type="button" data-action="view" data-holdings-updated-only aria-pressed="'+onlyUpdated+'">'+(onlyUpdated?'查看全部基金':'只看更新')+'</button></section>';
}
export function holdingsResultRow(row,report,unread=false){
 const labels={updated:'已更新',unchanged:'无变化',failed:'同步失败',unsupported:'不适用'};
 const rows=row.holdings?.rows??report.data?.items?.find(f=>f.code===row.code&&f.latestHoldings?.asOf===row.date)?.latestHoldings?.rows??[];
 const notes=[row.message,row.calculationMessage].filter(Boolean);
 const note=notes.length?'<details class="holdingsResultNote"><summary>详情</summary><p>'+notes.map(esc).join('<br>')+'</p></details>':'';
 const source=row.date&&['updated','unchanged'].includes(row.status)?'<button type="button" data-action="view" class="holdingsSourceButton" data-holdings-changes="'+esc(row.code)+'" aria-haspopup="dialog" aria-controls="holdingsChangesDialog">公告原文 ↗</button>':'';
 return '<tr data-holdings-row="'+esc(row.code)+'"><td><span class="holdingsFundName">'+esc(row.name)+(unread?'<span class="dot holdingsDot" role="img" aria-label="持仓有更新，移入此行标为已读" title="本次持仓有更新"></span>':'')+'</span><button type="button" class="syncTag" data-sync-one="'+esc(row.code)+'" aria-label="单独重新同步 '+esc(row.name)+'">同步</button><small>'+esc(row.code)+'</small></td><td>'+esc(row.date??row.previousDate??'—')+'<small class="holdingsDateNote">'+esc(holdingsDateNote(row))+'</small></td><td>'+row.count+'</td><td>'+holdingsBars(rows)+'</td><td><div class="holdingsResultActions"><strong class="holdingsResultLabel">'+labels[row.status]+'</strong>'+holdingsComparison(row)+source+(row.status==='failed'||row.status==='unsupported'?'<small class="error">'+esc(row.message)+'</small>':note)+'</div></td></tr>';
}
function holdingsDateNote(row){
 if(row.status==='failed')return row.date||row.previousDate?'同步失败，保留原持仓':'';
 if(row.status==='unsupported'||!row.date)return '';
 if(!row.previousDate)return '首次同步';
 if(row.previousDate!==row.date)return '上期截至 '+row.previousDate;
 return row.status==='unchanged'?'本次无变化':'同一期持仓已更新';
}
export function holdingsDateSummary(row){
 return '持仓截至 '+(row.date??row.previousDate??'—')+(holdingsDateNote(row)?' · '+holdingsDateNote(row):'');
}
export function pageRows(rows,page=1,size=10){
 const pages=Math.max(1,Math.ceil(rows.length/size));
 page=Math.max(1,Math.min(pages,Math.trunc(Number(page))||1));
 return {rows:rows.slice((page-1)*size,page*size),page,pages,total:rows.length,size};
}
export function pagination(info,scope){
 return '<nav class="holdingsPagination" aria-label="'+(scope==='holdings'?'基金列表':'详情持仓')+'分页"><span>共 '+info.total+' 条 · 第 '+info.page+' / '+info.pages+' 页 · 每页 '+info.size+' 条</span>'+[[1,'首页',info.page===1],[info.page-1,'上一页',info.page===1],[info.page+1,'下一页',info.page===info.pages],[info.pages,'末页',info.page===info.pages]].map(([page,label,disabled])=>'<button type="button" data-action="view" data-page-scope="'+scope+'" data-page="'+page+'" '+(disabled?'disabled':'')+'>'+label+'</button>').join('')+'</nav>';
}
const colors=['#2563eb','#0891b2','#0d9488','#65a30d','#d97706','#ea580c','#dc2626','#db2777','#9333ea','#4f46e5','#cbd5e1'];
export function holdingSlices(rows=[]){
 const top=rows.filter(r=>Number.isFinite(r.weight)&&r.weight>0).sort((a,b)=>b.weight-a.weight).slice(0,10);
 if(!top.length)return {slices:[],invalid:false};
 const total=top.reduce((sum,r)=>sum+r.weight,0);
 if(total>100.01)return {slices:[],invalid:true};
 // Round to basis points so the displayed percentages also sum to exactly 100%.
 let remaining=10000;
 const slices=top.map((r,i)=>{const units=Math.min(remaining,Math.round(r.weight*100));remaining-=units;return {name:r.name||r.code,code:r.code,weight:units/100,color:colors[i]};});
 slices.push({name:'其他',weight:remaining/100,color:colors[10]});
 return {slices,invalid:false};
}
export function holdingsBars(rows){
 const {slices,invalid}=holdingSlices(rows);
 if(!slices.length)return '<span class="muted">'+(invalid?'持仓权重合计异常，暂无法绘图':'暂无持仓占比数据')+'</span>';
 let offset=0;
 const segments=slices.filter(s=>s.weight>0).map(s=>{
  const start=offset;offset+=Math.round(s.weight*100);
  return '<rect x="'+start/100+'" y="0" width="'+s.weight+'" height="2" fill="'+s.color+'"/>';
 }).join('');
 const summary='前10大持仓及其他，占基金净资产比例：'+slices.map(s=>s.name+' '+s.weight.toFixed(2)+'%').join('，');
 const labels=slices.map(s=>'<span class="holdingsInlineItem" title="'+esc(s.name+(s.code?' · '+s.code:'')+' '+s.weight.toFixed(2)+'%')+'"><svg viewBox="0 0 8 8" aria-hidden="true"><rect width="8" height="8" rx="2" fill="'+s.color+'"/></svg><span class="holdingsInlineName">'+esc(s.name)+'</span><strong>'+s.weight.toFixed(2)+'%</strong></span>').join('');
 return '<div class="holdingsInline"><button type="button" class="holdingsScrollButton" data-holdings-scroll="-1" aria-label="向左查看持仓" title="向左查看持仓">‹</button><div class="holdingsNameViewport" tabindex="0" role="region" aria-label="持仓名称与占比，可左右滚动">'+labels+'</div><button type="button" class="holdingsScrollButton" data-holdings-scroll="1" aria-label="向右查看持仓" title="向右查看持仓">›</button><svg class="holdingsMiniStack" viewBox="0 0 100 2" preserveAspectRatio="none" aria-hidden="true"><title>'+esc(summary)+'</title>'+segments+'</svg></div>';
}
