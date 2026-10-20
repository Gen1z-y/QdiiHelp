import {pageRows,pagination} from './holdings-ui.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>Number.isFinite(v)?`${v>0?'+':''}${(v*100).toFixed(2)}%`:'—';
const num=v=>Number.isFinite(v)?v.toFixed(2):'—';
export function navPeriodLabel(interval={},fallback=''){
 const to=interval.to??fallback;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(to))return '日期待确认';
 const format=d=>Number(d.slice(5,7))+'月'+Number(d.slice(8))+'日';
 if(interval.mode!=='cumulative'||!/^\d{4}-\d{2}-\d{2}$/.test(interval.from??''))return format(to);
 const start=new Date(Date.parse(interval.from+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 return start.slice(0,7)===to.slice(0,7)?format(start)+'至'+Number(to.slice(8))+'日':format(start)+'至'+format(to);
}
export function dateStatus(f,{automatic=true,now=new Date()}={}){
 if(automatic&&f.bond&&f.domesticClosure){
  const c=f.domesticClosure,label=c.reason==='周末休市'?'周末休市':'节假日期间';
  return c.publishedDate?`${label} · 最近公布 ${c.publishedDate}${c.publishedDate===c.today?'，已获取新净值':'；暂无新公布净值'}`:`${label} · 暂无可用公布净值`;
 }
 if(f.fromSaved&&f.requestedDate&&f.requestedDate!==f.date)return `本机历史结果 · ${f.date}；${f.refreshComplete?'暂无':'正在获取'} ${f.requestedDate} 的数据`;
 const interval=f.navEstimate;
 if(interval?.asOf){
  const kind=navPeriodLabel(interval)+(interval.mode==='cumulative'?'合计预估':'预估');
  const status=interval.status==='published'?'基金公司已公布，可核对':interval.partial?'还没算完，目前计入到 '+interval.asOf+' 的行情':interval.status==='sealed'?'预估已保存，等基金公司公布':'正在等数据补齐';
  return kind+'。'+status+'。'+(interval.provisional?'起点净值还没公布，金额暂按预估计算。':'');
 }
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const weekend=[0,6].includes(new Date(today+'T12:00:00Z').getUTCDay());
 const previous=new Date(today+'T12:00:00Z');
 do{previous.setUTCDate(previous.getUTCDate()-1);}while([0,6].includes(previous.getUTCDay()));
 const date=f.date??'—',forecast=f.record?.forecast;
 const state=f.record?.actual?'正式涨跌已公布':forecast?'收盘估算':'等待数据';
 const prefix=!automatic?'手选日期':'本次净值日期';
 const note=automatic&&!f.bond&&weekend&&date===previous.toISOString().slice(0,10)?'；周末不新增单日预估':'';
 return `${prefix} · ${date} ${state}${note}`;
}
export function quoteStatusBadge(row){
 const status=row.marketStatus;
 let tone='unknown',label='暂无行情';
 if(status?.state==='pending'){tone='pending';label='待收盘';}
 else if(row.error){tone='error';label='行情异常';}
 else if(row.stale){tone='pending';label='上次的行情';}
 else if(status?.state==='closed'){tone='closed';label='正常休市';}
 else if(Number.isFinite(row.rmbReturn)){tone='complete';label='行情可用';}
 else if(status?.state==='complete'&&status.known===false){label='休市安排待确认';}
 else if(status?.state==='complete'||Number.isFinite(row.rmbReturn)){tone='complete';label=Number.isFinite(row.rmbReturn)?'行情可用':'已过收盘时间';}
 const detail=row.error||status?.message||(row.stale?'使用缓存，等待更新':'');
 return `<span class="quoteStatus quoteStatus-${tone}" title="${esc(detail)}">${label}</span>${detail?` <span class="quoteStatusText quoteStatusText-${tone}">${esc(detail)}</span>`:''}`;
}
export function quoteStatusTone(row){return /quoteStatus-(complete|closed|pending|error|unknown)/.exec(quoteStatusBadge(row))[1];}
export function quoteStatusLegend(active='all'){
 return '<div class="quoteStatusLegend" role="group" aria-label="筛选持仓行情状态">'+[['all','全部'],['complete','行情可用'],['closed','正常休市'],['pending','等收盘 / 上次行情'],['error','行情异常'],['unknown','暂无数据 / 休市安排待确认']].map(([tone,label])=>`<button type="button" class="quoteStatus quoteStatus-${tone}" data-quote-filter="${tone}" aria-pressed="${tone===active}">${label}</button>`).join('')+'</div>';
}
function validationPanel(groups,labels){
 return groups.filter(g=>g.validation).map(g=>{
  const v=g.validation,max=Math.max(.01,...v.points.map(p=>Math.abs(p.error)));
  const points=v.points.map((p,i)=>(15+i*370/Math.max(1,v.points.length-1)).toFixed(1)+','+(65-p.error/max*45).toFixed(1)).join(' ');
  return '<section class="calibrationValidation"><h4>'+esc(labels[g.method]??g.method)+' · 后续样本验证</h4><p>最近 '+v.recentCount+' 次平均误差 '+num(v.recentMae)+' 个百分点；此前 '+v.previousCount+' 次 '+num(v.previousMae)+' 个百分点。</p><svg class="errorTrend" viewBox="0 0 400 130" role="img" aria-label="近期预估误差，横轴从早到晚，零线上方为预估偏高"><line x1="10" y1="65" x2="390" y2="65" stroke="#a7adb7"/><polyline points="'+points+'" fill="none" stroke="#526da1" stroke-width="2"/>'+v.points.map((p,i)=>'<circle cx="'+(15+i*370/Math.max(1,v.points.length-1)).toFixed(1)+'" cy="'+(65-p.error/max*45).toFixed(1)+'" r="3" fill="#526da1"><title>'+esc(p.date)+'：'+num(p.error)+' 个百分点</title></circle>').join('')+'<text x="12" y="122" font-size="10">'+esc(v.points[0]?.date??'')+'</text><text x="388" y="122" text-anchor="end" font-size="10">'+esc(v.points.at(-1)?.date??'')+'</text><text x="12" y="13" font-size="10">纵轴 ±'+num(max)+' 个百分点 · 0为一致</text></svg>'+(v.count?'<p>用此前10–30次已知结果校准，逐次检验后续 '+v.count+' 个样本（'+esc(v.from)+' 至 '+esc(v.to)+'）：原预估平均误差 <strong>'+num(v.rawMae)+'</strong>，校准后 <strong>'+num(v.correctedMae)+'</strong> 个百分点。</p><p>'+((v.improvement??0)>0?'这批样本中校准误差较小':'这批样本中校准未降低误差')+'；不保证未来效果。</p>':'<p class="muted">尚无足够的后续样本；每个待检验样本至少需要此前10次已经获知正式值的同模型记录。</p>')+'<p class="muted">校准只使用计算当时已知的公布结果，主预估和封存记录保持原值。历史平均误差不是置信区间。</p></section>';
 }).join('');
}
export function accuracyPanel(stats){
 const groups=stats?.groups??[],excluded=stats?.excluded??{};
 const labels={'market-close-v4':'按更多已公布持仓估算','market-close-v3':'按前十大持仓估算','market-close-v2':'按持仓估算（旧版）','index-proxy-v3':'按指数估算','index-proxy-v2':'按指数估算（旧版）','bond-fit-v1':'按国债指数拟合（债基）'};
 const w0=groups[0]?.windows?.[0];
 const headline=w0&&w0.count>=10?`<p class="note">近 ${w0.count} 次对比：预估平均相差 ${num(w0.mae)} 个百分点，${w0.bias>0.005?'整体偏高':w0.bias<-0.005?'整体偏低':'无明显高低偏差'} ${num(Math.abs(w0.bias))} 个百分点，涨跌方向猜对 ${Number.isFinite(w0.direction)?(w0.direction*100).toFixed(0)+'%':'—'}。这是该基金的历史表现，仅提示，不修改任何预估。</p>`:'';
 return `<section class="accuracyPanel"><h3>预估准不准 · 已对比 ${stats?.pairedCount??0} 次</h3><p class="muted">把同一段时间的预估与正式结果对比。例如预估涨2%、实际涨1%，就差1个百分点。记录少时，还不能判断准不准。</p>${headline}${groups.length?`<div class="tablewrap"><table><thead><tr><th>估算方法</th><th>最多对比次数</th><th>已对比次数</th><th>平均相差（百分点）</th><th>平均偏高 / 偏低（百分点）</th><th>涨跌方向猜对比例</th></tr></thead><tbody>${groups.flatMap(g=>g.windows.map(w=>`<tr><td>${esc(labels[g.method]??g.method)}</td><td>${w.limit} 个<small>${esc(w.from??'—')} → ${esc(w.to??'—')}</small></td><td>${w.count}${w.count<w.limit?'（记录还少）':''}</td><td>${num(w.mae)}</td><td>${num(w.bias)}</td><td>${Number.isFinite(w.direction)?(w.direction*100).toFixed(1)+'%':'—'}</td></tr>`)).join('')}</tbody></table></div>`:'<p class="muted">还没有足够的预估和正式结果可以对比。</p>'}${validationPanel(groups,labels)}<details><summary>哪些记录没有参与对比？</summary><p class="muted">没有计入：缺预测或公布值 ${excluded.unpaired??0} 条；比较的日期不一致或缺少起点净值 ${excluded.interval??0} 条；无法确认是否在公布前保存 ${excluded.timestamp??0} 条；其他无效 ${excluded.invalid??0} 条。保留原记录，不用已公布结果补造预估。</p></details></section>`;
}
export function contributionRows(rows,mode='daily'){
 return rows.map(r=>{
  const daily=mode==='daily',stock=daily?r.dailyStock:r.stock,fx=daily?r.dailyFx:r.fx;
  const ret=daily?r.dailyRmbReturn:r.rmbReturn;
  return {...r,shownStock:stock,shownFx:fx,shownContribution:Number.isFinite(ret)&&Number.isFinite(r.weight)?r.weight/100*ret:null};
 }).sort((a,b)=>(Number.isFinite(b.weight)?b.weight:-Infinity)-(Number.isFinite(a.weight)?a.weight:-Infinity));
}
export function indexContributionRows(forecast){
 const q=forecast?.indexQuote;if(!q)return [];
 const dailyBase=q.valuationPreviousClose??q.previousClose,dailyDate=q.valuationPreviousQuoteDate??q.previousDate;
 return [{name:q.name??q.id,code:q.id,weight:100,quoteSource:q.source,marketStatus:q.marketStatus,error:q.error,stale:q.stale,
  stock:{base:{date:q.baseDate},target:{date:q.date},return:q.close/q.baseClose-1},
  dailyStock:{base:{date:dailyDate},target:{date:q.date},return:q.close/dailyBase-1},
  fx:forecast.fx,dailyFx:forecast.dailyFx,rmbReturn:forecast.model?.return,dailyRmbReturn:forecast.model?.dailyReturn}];
}
export function contributionPanel(rows,mode='daily',holdingsDate,page=1,filter='all'){
 if(!rows.length)return '';
 const daily=mode==='daily',paged=pageRows(contributionRows(rows,mode).filter(r=>filter==='all'||quoteStatusTone(r)===filter),page);
 return `<h3>哪些股票影响了涨跌 · ${esc(holdingsDate??'—')}</h3><div class="contributionControls" role="group" aria-label="贡献区间"><button data-action="view" data-contribution="daily" aria-pressed="${daily}">只看一天</button><button data-action="view" data-contribution="cumulative" aria-pressed="${!daily}">看这段时间合计</button></div><p class="muted">${daily?'查看最近一天的影响':'查看本次预估这段时间的影响'}，按占基金比例从高到低排列。缺数据的地方留空；正数表示拉高预估，负数表示拉低预估。</p>${quoteStatusLegend(filter)}<div class="tablewrap"><table class="contributionTable"><thead><tr><th>股票 / 行情状态</th><th>占基金比例</th><th>${daily?'单日':'区间'}股价涨跌</th><th>汇率变动</th><th>对预估的影响（百分点）</th></tr></thead><tbody>${paged.rows.map(r=>`<tr><td>${esc(r.name)}<small>${esc(r.code)} · ${esc(r.shownStock?r.shownStock.base.date+' → '+r.shownStock.target.date:'缺少该区间行情')}<br>${esc(r.quoteSource??'')}<br>${quoteStatusBadge(r)}${r.notes?.length?'<br>'+esc(r.notes.join('；')):''}${r.shownFx?.target?'<br>汇率 '+esc(r.shownFx.base.date)+' → '+esc(r.shownFx.target.date):''}</small></td><td>${num(r.weight)}%</td><td class="${r.shownStock?.return>0?'up':r.shownStock?.return<0?'down':''}"><span class="changeValue">${pct(r.shownStock?.return)}</span></td><td class="${r.shownFx?.return>0?'up':r.shownFx?.return<0?'down':''}"><span class="changeValue">${pct(r.shownFx?.return)}</span></td><td class="${r.shownContribution>0?'up':r.shownContribution<0?'down':''}"><span class="changeValue">${num(Number.isFinite(r.shownContribution)?r.shownContribution*100:null)}</span></td></tr>`).join('')}</tbody></table></div>${paged.rows.length?'':'<p class="muted">此状态下没有持仓。</p>'}${pagination(paged,'contribution')}`;
}

export function forecastInputs(f){
 return f.record?.forecast??(!f.record?.actual?f.record?.partialForecast:null)??f.analysis??null;
}

export function reliability(f){
 const issues=[],forecast=forecastInputs(f);
 const rows=forecast?.rows??[];
 const holdingDate=forecast?.holdingsDate??f.latestHoldings?.asOf;
 // Match the estimate shown in the summary, including its saved input snapshot.
 const coverage=forecast?.model?.coverage;
 if(f.error||f.stale)issues.push(f.error?'刷新异常，'+(f.stale?'沿用旧结果':'暂不可用'):'沿用旧结果');
 if(f.navWarning)issues.push('公布净值来源存在差异');
 if(f.navEstimate?.partial)issues.push('阶段累计尚未完整');
 if(f.navEstimate?.provisional)issues.push('起点净值尚未确认');
 const waitingNormally=f.bond&&/等待A股收盘确认|国内休市/.test(f.modelError??'');
 if(f.modelError&&!f.record?.actual&&!waitingNormally)issues.push(f.modelError);
 if(!f.bond&&!f.index&&!f.indexQuote){
  if(!holdingDate)issues.push('缺少披露持仓');
  if(Number.isFinite(coverage)&&coverage<50)issues.push('有效资产覆盖不足50%');
  const age=holdingDate&&f.date?(Date.parse(f.date)-Date.parse(holdingDate))/86400000:null;
  if(age>190)issues.push('持仓已超过190天');
 }
 if(rows.some(r=>r.error||r.stale))issues.push('部分持仓缺行情或沿用旧行情');
 const target=f.navEstimate?.asOf??forecast?.date??f.date;
 if([forecast?.fx,forecast?.dailyFx,...rows.flatMap(r=>[r.fx,r.dailyFx])].some(fx=>fx?.target?.date&&target&&fx.target.date<target))issues.push('汇率沿用较早日期');
 if(rows.some(r=>r.marketStatus?.known===false))issues.push('部分市场日历未覆盖');
 return {attention:issues.length>0,issues:[...new Set(issues)],holdingDate,coverage};
}
export function reliabilityPanel(f){
 const r=reliability(f),coverage=Number.isFinite(r.coverage)?r.coverage.toFixed(2)+'%':'—';
 return `<details class="reliability ${r.attention?'needsAttention':''}"><summary>${r.attention?'需要注意 · '+r.issues.length+' 项':'数据检查 · 暂无已识别异常'}</summary><p class="muted">${f.bond?'债基指数拟合':f.index||f.indexQuote?'指数近似模型':'披露持仓 '+esc(r.holdingDate??'暂无')+' · 有效资产覆盖 '+coverage}。数据完整性不代表准确率。</p>${r.issues.length?'<ul>'+r.issues.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':''}</details>`;
}

// Exact FX component of the existing model: w * (1 + local return) * FX return.
// The cross term is assigned to FX so price + FX equals the RMB contribution.
export function fundFxImpact(fund){
 if(fund.navEstimate&&!Number.isFinite(fund.navEstimate.return))return null;
 const forecast=forecastInputs(fund);
 if(!forecast||!Number.isFinite(forecast.model?.return))return null;
 const from=forecast.base?.date,to=forecast.asOf??forecast.date;
 if(!from||!to)return null;
 if(forecast.model.method?.startsWith('index-proxy')){
  const q=forecast.indexQuote,fx=forecast.fx;
  if(!(q?.baseClose>0)||!Number.isFinite(q.close)||!Number.isFinite(fx?.return))return null;
  return {from,to,index:true,coverage:100,foreignWeight:100,contribution:q.close/q.baseClose*fx.return};
 }
 const rows=(forecast.rows??[]).filter(r=>r.weight>0&&Number.isFinite(r.rmbReturn)&&Number.isFinite(r.stock?.return)
  &&(r.currency==='CNY'||r.currency&&Number.isFinite(r.fx?.return)));
 if(!rows.length)return null;
 return {from,to,index:false,coverage:rows.reduce((n,r)=>n+r.weight,0),
  foreignWeight:rows.filter(r=>r.currency!=='CNY').reduce((n,r)=>n+r.weight,0),
  contribution:rows.reduce((n,r)=>n+(r.currency==='CNY'?0:r.weight/100*(1+r.stock.return)*r.fx.return),0)};
}
