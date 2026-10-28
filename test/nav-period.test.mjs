import test from 'node:test';
import assert from 'node:assert/strict';
import {planForFund,navEstimate,reconcileObservation} from '../lib/nav-observation.mjs';
import {fundCalendarDay} from '../lib/fund-nav-calendar.mjs';
import {captureStage,pendingPublications,marketProgress,PERIOD_VERSION} from '../lib/nav-period.mjs';
import {annotateNavPeriods} from '../lib/nav-publication.mjs';
import {forecastStats} from '../lib/forecast-stats.mjs';
import {detailHistoryChart,cumulativeChartRows} from '../public/forecast-chart.js';
import {observationPanel,estimateLabel} from '../public/forecast-details.js';
const holding=secid=>({asOf:'2026-09-30',rows:[{secid,weight:100}]});
const forecast=(date,from,extra={})=>({date,base:{date:from,value:1},model:{return:.03,value:1.03,dailyReturn:.01,method:'test'},calculatedAt:date+'T23:00:00Z',...extra});

test('各基金按上市市场独立排期，未知市场使用保守检查且不按美元猜市场',()=>{
 const now=new Date('2026-10-22T18:00:00+08:00');
 const hk=planForFund({code:'111111',holding:holding('116.TEST')},now);
 const us=planForFund({code:'222222',holding:holding('105.TEST')},now);
 const unknown=planForFund({code:'333333',holding:{rows:[{weight:80,currency:'USD'}]}},now);
 assert.equal(hk.target,'2026-10-22');assert.equal(us.target,'2026-10-21');
 assert.equal(unknown.exposure.known,false);assert.equal(unknown.target,us.target);
 assert.deepEqual(hk.exposure.markets,['HK']);
 const partial=planForFund({code:'444444',holding:{rows:[{secid:'116.TEST',weight:40}]}},now);
 assert.equal(partial.exposure.known,true);assert.equal(partial.exposure.timingComplete,false);
 assert.equal(partial.target,us.target,'未披露部分不能被当成没有其他市场');
});

test('基金非开放公告只产生待确认投影，明确不估值规则和实际发布可覆盖它',()=>{
 const now=new Date('2026-10-20T10:00:00+08:00');
 const tentative=planForFund({code:'018147',indexId:'NDX'},now);
 assert.equal(tentative.target,'2026-10-20');assert.equal(tentative.expectedBase,'2026-10-16');
 assert.equal(tentative.targetConfirmed,false);assert.equal(tentative.notices[0].uncertain,true);
 const rule={source:'fixture:manager',from:'2026-01-01',to:'2026-12-31',nonValuationDates:['2026-10-19']};
 assert.equal(planForFund({code:'018147',indexId:'NDX',rule},now).targetConfirmed,true);
 const published=planForFund({code:'018147',indexId:'NDX',nav:[{date:'2026-10-19',value:1},{date:'2026-10-16',value:1}]},now);
 assert.equal(published.target,'2026-10-19');
 const after=planForFund({code:'018147',indexId:'NDX',nav:[{date:'2026-10-19',value:1},{date:'2026-10-16',value:1}]},new Date('2026-10-21T10:00:00+08:00'));
 assert.equal(after.expectedBase,'2026-10-19');assert.equal(after.targetConfirmed,true);
 assert.equal(fundCalendarDay('018147','2026-10-19').noValuation,false);
 assert.equal(fundCalendarDay('018147','2026-10-19',rule).noValuation,true);
});

test('缺少应有基准时显示独立长区间参考，不封存、不混入单期准确率',()=>{
 const f=forecast('2026-10-21','2026-10-16',{periodVersion:PERIOD_VERSION,referenceOnly:true,valuationBaseDate:'2026-10-20'});
 const record=reconcileObservation(null,f,null,'2026-10-22T01:01:00Z',{target:f.date});
 const view=navEstimate({date:f.date,record});
 assert.equal(view.return,.03);assert.equal(view.mode,'cumulative');assert.equal(view.referenceOnly,true);assert.equal(record.sealedAt,undefined);
 record.actual={date:f.date,previousDate:'2026-10-20',value:1.02,dailyReturn:.01};record.firstActualSeenAt='2026-10-23T00:00:00Z';
 assert.equal(forecastStats('111111',{'111111:2026-10-21':record}).pairedCount,0);
});

test('阶段按截至日分别保存，正式值到达和强制刷新不会把旧预测或阶段改写',()=>{
 let r=reconcileObservation(null,forecast('2026-10-01','2026-09-30'),null,'a',{target:'2026-10-08',asOf:'2026-10-01'});
 r=reconcileObservation(r,forecast('2026-10-02','2026-09-30'),null,'b',{target:'2026-10-08',asOf:'2026-10-02'});
 assert.deepEqual(r.stages.map(s=>s.date),['2026-10-01','2026-10-02']);
 const stages=JSON.stringify(r.stages);
 r=reconcileObservation(r,forecast('2026-10-08','2026-09-30'),null,'c',{target:'2026-10-08'});
 const saved=r.forecast;
 r=reconcileObservation(r,forecast('2026-10-08','2026-09-30',{model:{return:.99,value:1.99}}),{date:'2026-10-08',previousDate:'2026-09-30',value:1.04,dailyReturn:.04},'d',{target:'2026-10-08'});
 assert.equal(r.forecast,saved);assert.equal(JSON.stringify(r.stages.slice(0,2)),stages);
 assert.equal(captureStage(r,forecast('2026-10-09','2026-09-30'),'2026-10-09','e'),r);
});

test('多个待公布记录独立保留，旧日期正式结果到达后仅结清对应日期',()=>{
 const records={'111111:2026-10-19':{forecast:forecast('2026-10-19','2026-10-16')},'111111:2026-10-20':{forecast:forecast('2026-10-20','2026-10-19')},'222222:2026-10-19':{forecast:forecast('2026-10-19','2026-10-16')}};
 assert.equal(pendingPublications('111111',records,'2026-10-20').length,2);
 records['111111:2026-10-19']=reconcileObservation(records['111111:2026-10-19'],null,{date:'2026-10-19',value:1},'now',{target:'2026-10-19'});
 assert.deepEqual(pendingPublications('111111',records,'2026-10-20').map(r=>r.date),['2026-10-20']);
});

test('主源非空涨跌也携带实际相邻净值日；每期图保留区间和阶段，累计参考不重复相乘',()=>{
 const published=annotateNavPeriods([{date:'2026-10-08',value:1.03,dailyReturn:.03},{date:'2026-09-30',value:1,dailyReturn:0}]);
 assert.equal(published[0].returnFrom,'2026-09-30');
 const html=detailHistoryChart([{date:'2026-09-30',actual:0},{date:'2026-10-08',actual:null}],90,'periodic',[],published,[{date:'2026-10-01',target:'2026-10-08',from:'2026-09-30',return:.02}]);
 assert.match(html,/每期涨跌/);assert.match(html,/公布区间 2026-09-30/);assert.match(html,/阶段区间参考/);
 const values=JSON.parse(html.match(/data-chart-values="([^"]+)"/)[1].replaceAll('&quot;','"'));
 assert.equal(values.find(r=>r.date==='2026-10-01').actual,null);
 assert.equal(values.find(r=>r.date==='2026-10-01').reference,.02);
 const c=cumulativeChartRows([{date:'2026-09-30',actual:0},{date:'2026-10-01',reference:.02,referenceFrom:'2026-09-30'},{date:'2026-10-02',reference:.01,referenceFrom:'2026-09-30'}]);
 assert.ok(Math.abs(c.rows[2].reference-.01)<1e-12);
});

test('详情展示真实市场进度、未知估值安排及待公布列表，并转义外部文本',()=>{
 const fund={date:'2026-10-20',asOf:'2026-10-19',navEstimate:{from:'2026-10-16',asOf:'2026-10-19',partial:true,targetConfirmed:false},
  plan:{notices:[{date:'2026-10-19',reason:'<假日>',uncertain:true}]},record:{partialForecast:{date:'2026-10-20',asOf:'2026-10-19',rows:[{secid:'116.TEST',market:'香港',weight:50,rmbReturn:.01,stock:{target:{date:'2026-10-16'}},marketStatus:{state:'closed',message:'假日'}}]}}};
 fund.marketProgress=marketProgress(fund,new Date('2026-10-20T10:00:00+08:00'));
 assert.equal(fund.marketProgress[0].state,'closed');assert.equal(estimateLabel(fund),'阶段区间预估');
 const html=observationPanel(fund);assert.match(html,/净值归属待确认/);assert.match(html,/暂停申赎，估值安排待确认/);assert.match(html,/&lt;假日&gt;/);assert.doesNotMatch(html,/<假日>/);
});
