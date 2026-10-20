const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
export function holdingsPie(rows){
 const {slices,invalid}=holdingSlices(rows);
 if(!slices.length)return '<span class="muted">'+(invalid?'持仓权重合计异常，暂无法绘图':'暂无持仓占比数据')+'</span>';
 let angle=-Math.PI/2;
 const sectors=slices.map(s=>{
  const start=angle;angle+=s.weight/100*Math.PI*2;
  if(s.weight<=0)return '';
  if(s.weight>=100)return '<circle cx="65" cy="65" r="65" fill="'+s.color+'"/>';
  const x=a=>65+65*Math.cos(a),y=a=>65+65*Math.sin(a);
  return '<path d="M65 65 L'+x(start)+' '+y(start)+' A65 65 0 '+(s.weight>50?1:0)+' 1 '+x(angle)+' '+y(angle)+' Z" fill="'+s.color+'"/>';
 }).join('');
 const summary=slices.map(s=>s.name+' '+s.weight.toFixed(2)+'%').join('，');
 return '<div class="holdingsComposition"><svg class="holdingsPie" viewBox="0 0 130 130" role="img" aria-label="'+esc(summary)+'">'+sectors+'</svg><ul class="holdingsLegend">'+slices.map(s=>'<li><svg class="holdingSwatch" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="2" fill="'+s.color+'"/></svg><span title="'+esc(s.code||s.name)+'">'+esc(s.name)+'</span><strong>'+s.weight.toFixed(2)+'%</strong></li>').join('')+'</ul></div>';
}
