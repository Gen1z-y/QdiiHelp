import {requestJson} from './request.js';
const el=document.querySelector('#performance');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>Number.isFinite(v)?`${v>0?'+':''}${(v*100).toFixed(2)}%`:'—';
const colors=['#e26d49','#357ce0','#2c9d7a','#9b68bc','#b38300','#c34f88','#168eaa','#596579'];
let codes=[],days=90,mode='cumulative',result=null,version=0;
el.innerHTML='<div class="sectionhead"><h2>收益走势 <span>历史实际涨跌幅对比</span></h2><button data-action="update" id="reloadHistory">更新历史数据</button></div><div class="chartbody"><div class="chartcontrols"><div id="ranges" class="historyRanges" role="group" aria-label="历史时间范围">'+[[30,'近1月'],[90,'近3月'],[180,'近6月'],[365,'近1年'],[1095,'近3年'],[1825,'近5年'],[0,'成立以来']].map(([v,s])=>`<button data-action="view" data-days="${v}" class="${v===days?'active':''}">${s}</button>`).join('')+'</div><select id="chartMode" aria-label="图表指标"><option value="cumulative">累计涨跌幅</option><option value="daily">单日涨跌幅</option></select></div><p id="chartStatus" role="status">正在逐页下载历史数据…</p><div id="chartLegend"></div><div id="chartCanvas"></div><label class="chartslider">选择日期查看数值 <input id="chartDate" type="range" min="0" value="0" aria-label="查看历史日期"></label><div id="chartTooltip" aria-live="polite"></div><div id="chartSummary"></div><p class="muted">选择2–8只基金，对比同一段时间的实际表现。曲线从同一天的0%开始，按基金公司公布的涨跌计算。这里不是预估准确率，结果可能与其他平台不同。</p></div>';
async function load(force=false){
  if(codes.length<2){++version;result=null;document.querySelector('#chartStatus').textContent='请选择2–8只基金开始对比';for(const id of ['chartCanvas','chartSummary','chartLegend','chartTooltip'])document.getElementById(id).innerHTML='';return;}
  const n=++version;document.querySelector('#chartStatus').textContent='正在逐页获取历史净值，首次下载可能需要几十秒…';
  try{const j=await requestJson('/api/history?days='+days+(codes.length?'&codes='+codes.join(','):'')+(force?'&refresh=1':''),{},600000);if(n!==version)return;result=j;draw();}
  catch(e){if(n!==version)return;result=null;document.querySelector('#chartStatus').textContent='历史数据加载失败：'+e.message;document.querySelector('#chartCanvas').innerHTML='';document.querySelector('#chartSummary').innerHTML='';document.querySelector('#chartLegend').innerHTML='';document.querySelector('#chartTooltip').textContent='';}
}
function draw(){
  if(!result)return;
  document.querySelector('#chartStatus').textContent=`比较日期 ${result.base} 至 ${result.end} · ${result.dates.length} 个可比较的日期`+(result.series.some(s=>s.derivedDates?.length)?' · 部分缺失日涨幅已按单位/累计净值补算，存在舍入和分红处理误差':'')+(result.series.some(s=>s.stale)?' · 部分数据源更新失败，正在使用本地历史缓存':'');
  document.querySelector('#chartLegend').innerHTML=result.series.map((s,i)=>`<span class="series s${i}">${esc(s.name)} (${s.code})</span>`).join('');
  const values=result.series.flatMap(s=>s.points.map(p=>p[mode])).filter(Number.isFinite),min=values.reduce((a,b)=>Math.min(a,b),0),max=values.reduce((a,b)=>Math.max(a,b),0),span=max-min||.02;
  const lo=min-span*.12,hi=max+span*.12,w=1000,h=310,left=68,right=20,top=20,bottom=36;
  const x=i=>left+i*(w-left-right)/Math.max(1,result.dates.length-1),y=v=>top+(hi-v)/(hi-lo)*(h-top-bottom);
  let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${mode==='daily'?'每日':'累计'}涨跌幅曲线">`;
  for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4,yy=y(v);svg+=`<line x1="${left}" x2="${w-right}" y1="${yy}" y2="${yy}" stroke="#e8ede7"/><text x="${left-10}" y="${yy+4}" text-anchor="end" fill="#849286" font-size="12">${pct(v)}</text>`;}
  svg+=`<line x1="${left}" x2="${w-right}" y1="${y(0)}" y2="${y(0)}" stroke="#a7b9ad" stroke-dasharray="4 4"/>`;
  result.series.forEach((s,i)=>{let path='',connected=false;for(let n=0;n<s.points.length;n++){const value=s.points[n][mode];if(!Number.isFinite(value)){connected=false;continue;}path+=(connected?' L':' M')+x(n).toFixed(2)+' '+y(value).toFixed(2);connected=true;}svg+=`<path d="${path}" fill="none" stroke="${colors[i]}" stroke-width="2.5"/>`;});
  svg+=`<text x="${left}" y="${h-8}" fill="#849286" font-size="12">${result.base}</text><text x="${w-right}" y="${h-8}" text-anchor="end" fill="#849286" font-size="12">${result.end}</text></svg>`;
  document.querySelector('#chartCanvas').innerHTML=svg;
  const slider=document.querySelector('#chartDate');slider.max=result.dates.length-1;slider.value=result.dates.length-1;inspect(Number(slider.value));
  document.querySelector('#chartCanvas').onpointermove=e=>{const box=e.currentTarget.getBoundingClientRect();const i=Math.max(0,Math.min(result.dates.length-1,Math.round(((e.clientX-box.left)/box.width*w-left)/(w-left-right)*(result.dates.length-1))));slider.value=i;inspect(i);};
  document.querySelector('#chartSummary').innerHTML='<div class="tablewrap"><table><thead><tr><th>基金</th><th>这段时间合计涨跌</th><th>这段时间从高点最多跌了多少</th><th>历史数据更新时间</th></tr></thead><tbody>'+result.series.map(s=>`<tr><td>${esc(s.name)}</td><td>${pct(s.totalReturn)}</td><td>${pct(s.maxDrawdown)}</td><td>${esc(new Date(s.fetchedAt).toLocaleString('zh-CN'))}${s.stale?'（缓存）':''}</td></tr>`).join('')+'</tbody></table></div>';
}
function inspect(i){if(!result)return;document.querySelector('#chartTooltip').innerHTML=`<strong>${result.dates[i]}</strong>　`+result.series.map((s,n)=>`<span class="series s${n}">${s.code} ${pct(s.points[i][mode])}</span>`).join('');}
document.querySelector('#chartDate').oninput=e=>inspect(Number(e.target.value));
document.querySelector('#chartMode').onchange=e=>{mode=e.target.value;draw();};
document.querySelector('#ranges').onclick=e=>{const b=e.target.closest('[data-days]');if(!b)return;days=Number(b.dataset.days);document.querySelectorAll('[data-days]').forEach(b=>b.classList.toggle('active',Number(b.dataset.days)===days));load();};
document.querySelector('#reloadHistory').onclick=()=>load(true);
document.addEventListener('fund-selection',e=>{codes=e.detail;load();});
load();
