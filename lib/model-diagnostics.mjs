import {forecastStats} from './forecast-stats.mjs';
import {indexForFund} from './indices.mjs';
export function diagnoseFund({code,name,profile={},records={},latestView={}}){
 const stats=forecastStats(code,records,{validation:false}),ordered=Object.entries(records).sort(([a],[b])=>b.localeCompare(a));
 const forecast=ordered.map(([,r])=>r.forecast).find(Boolean),method=forecast?.model?.method??null;
 const group=stats.groups.find(g=>g.method===method),window=group?.windows[0];
 const rows=forecast?.rows??[],coverage=forecast?.model?.coverage;
 const holdingAge=forecast?.holdingsDate?(Date.parse(forecast.date)-Date.parse(forecast.holdingsDate))/86400000:null;
 const fxCarried=[forecast?.fx,forecast?.dailyFx,...rows.flatMap(r=>[r.fx,r.dailyFx])].some(fx=>fx?.target?.date&&fx.target.date<forecast.date);
 const constraints=[],next=[];
 if(!window?.count){constraints.push('没有可配对的事前样本');next.push('先积累公布前记录，不能判断准确性');}
 else if(window.count<10){constraints.push('有效样本不足10次');next.push('继续积累样本，暂不调整公式');}
 if(latestView.error){constraints.push('最近刷新异常');next.push('先修复输入可用性');}
 if(method?.startsWith('index-proxy')){constraints.push('按100%指数敞口与汇率近似');next.push('核实实际跟踪标的、敞口及份额币种后验证调整');}
 else if(method==='bond-fit-v1'||latestView.bond||profile.bond){constraints.push('三指数拟合，样本内R²不代表后续效果');next.push('按后续样本检查利率、信用及转债暴露拟合');}
 else{
  if(Number.isFinite(coverage)&&coverage<80){constraints.push('有效资产覆盖 '+coverage.toFixed(1)+'%，未覆盖部分未计贡献');next.push('优先核对披露持仓与缺失行情，不将剩余权重直接归一化');}
  if(holdingAge>90){constraints.push('样本持仓距目标日 '+Math.floor(holdingAge)+' 天');next.push('核对最新可用披露期及调仓影响');}
  if(rows.some(r=>r.error)){constraints.push('部分持仓缺少有效行情');next.push('先修复行情日期、复权与备用源');}
  if(/联接|指数/.test(name??'')&&!indexForFund(name??'')){constraints.push('当前名称规则未映射对应指数');next.push('依据基金正式跟踪标的核对映射');}
  if(profile.allocation?.stock===0){constraints.push('股票配置为0，股票模型不适用');next.push('核实基金投资等资产明细后再建立模型');}
 }
 if(fxCarried){constraints.push('最新保存样本沿用较早日期汇率');next.push('核对汇率来源、基准日和目标日，保持日期约束');}
 if(window?.count>=10&&Math.abs(window.bias)>.05)next.push('存在历史偏高/偏低，先检查输入口径；校准须另用后续样本验证');
 return {code,name,method,observations:ordered.length,pairedCount:stats.pairedCount,samples:window?.count??0,mae:window?.mae??null,bias:window?.bias??null,from:window?.from??null,to:window?.to??null,coverage:coverage??null,holdingAgeDays:holdingAge,fxCarried,constraints:[...new Set(constraints)],next:[...new Set(next)],excluded:stats.excluded};
}
export function diagnosisMarkdown(report){
 const esc=s=>String(s??'').replaceAll('|','\\|').replace(/[\r\n]/g,' '),num=n=>Number.isFinite(n)?n.toFixed(3):'—';
 return '# 基金预估偏差诊断\n\n生成日期：'+report.asOf+'。只读取已保存记录；未刷新行情、未重算预测、未修改模型。每只基金最多读取最近200条观察记录，按模型取最近30个有效配对。误差单位为百分点。首次观察正式值的时间不等于官方发布时间。\n\n| 基金 | 当前记录模型 | 有效样本 | 平均绝对误差 | 平均偏差 | 输入限制 | 下一步 |\n| --- | --- | ---: | ---: | ---: | --- | --- |\n'+report.items.map(f=>'| '+esc(f.name)+' '+f.code+' | '+esc(f.method??'无预测')+' | '+f.samples+' | '+num(f.mae)+' | '+num(f.bias)+' | '+esc(f.constraints.join('；')||'未从当前记录识别出特定原因')+' | '+esc(f.next.join('；')||'先观察后续样本，再决定是否调整')+' |').join('\n')+'\n\n这些是已保存样本的诊断线索，不能据此认定单一原因导致误差，也不保证未来效果。样本不足的基金不进行准确性排名。已封存预测保持原值。\n';
}
