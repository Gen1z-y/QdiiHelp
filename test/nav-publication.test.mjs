import test from 'node:test';
import assert from 'node:assert/strict';
import {navPercent,parseTencentNav,supplementNavReturn,mergePublishedNav} from '../lib/nav-publication.mjs';
import {canReuseView} from '../lib/load-policy.mjs';
import {reconcile} from '../lib/model.mjs';
const rows=[
 {date:'2026-10-20',value:2.0744,cumulativeNav:2.0744,dailyReturn:null},
 {date:'2026-10-16',value:2.0547,cumulativeNav:2.0547,dailyReturn:-.0278}
];
const text=(code='016701',value='2.0744',percent='0.9588',date='2026-10-20',name='人民币基金')=>
 'v_jj'+code+'="'+[code,name,'0','0','',value,value,percent,date,''].join('~')+'";';
test('缺值和非法增长率保持缺失，明确的0有效',()=>{
 for(const v of [null,undefined,'',' ','--','NaN','Infinity'])assert.equal(navPercent(v),null);
 assert.equal(navPercent('0'),0);assert.equal(navPercent('-1.2'),-.012);
 assert.equal(parseTencentNav('016701',text('016702')),null);
 assert.equal(parseTencentNav('016701',text('016701','2.0744','0.9588','2026-10-20','美元份额')),null);
 assert.equal(parseTencentNav('016701',text('016701','2.0744','')).dailyReturn,null);
});
test('缺少前一估值日时仅补充有来源的公布区间，不填单日涨跌',()=>{
 const filled=supplementNavReturn(rows,parseTencentNav('016701',text()),'2026-10-19');
 assert.equal(filled[0].dailyReturn,null);assert.equal(filled[0].intervalReturn,.009588);
 assert.equal(filled[0].returnFrom,'2026-10-16');assert.equal(filled[0].returnTo,'2026-10-20');
 assert.equal(filled[0].returnSource,'腾讯基金');assert.equal(rows[0].intervalReturn,undefined);
});
test('相邻估值日可以补齐单日涨跌，后续仍查询主源',()=>{
 const adjacent=[rows[0],{...rows[1],date:'2026-10-19'}];
 const filled=supplementNavReturn(adjacent,parseTencentNav('016701',text()),'2026-10-19')[0];
 assert.equal(filled.dailyReturn,.009588);assert.equal(filled.intervalReturn,undefined);
 assert.equal(canReuseView({date:filled.date,record:{actual:filled},checkedAt:new Date().toISOString()},null),false);
});
test('拒绝异日、异净值、无法匹配区间、分红或折算数据',()=>{
 for(const quote of [{...parseTencentNav('016701',text()),date:'2026-10-19'},
  {...parseTencentNav('016701',text()),value:2.075},{...parseTencentNav('016701',text()),dailyReturn:.02},
  {...parseTencentNav('016701',text()),dailyReturn:null}])
  assert.equal(supplementNavReturn(rows,quote,'2026-10-19'),rows);
 for(const change of [{distribution:'每份分红0.01元'},{adjustment:true},{cumulativeNav:2.08}]){
  const changed=[{...rows[0],...change},rows[1]];
  assert.equal(supplementNavReturn(changed,parseTencentNav('016701',text()),'2026-10-19'),changed);
 }
 assert.equal(supplementNavReturn(rows.slice(0,1),parseTencentNav('016701',text()),'2026-10-19').length,1);
});
test('不完整记录不再受5分钟或永久复用影响，完整主源仍可复用',()=>{
 const now=Date.now(),view={date:rows[0].date,record:{actual:rows[0]},checkedAt:new Date(now).toISOString()};
 for(const offset of [0,86400000])assert.equal(canReuseView(view,null,{now:now+offset}),false);
 assert.equal(canReuseView({...view,record:{actual:{...rows[0],dailyReturn:0}}},null,{now:now+1000}),true);
 assert.equal(canReuseView({...view,record:{actual:{...rows[0],dailyReturn:0}}},null,{now:now+86400000}),false);
});
test('同日同净值短暂缺字段不抹掉已有结果，主源补齐会移除备用标记',()=>{
 const partial=rows[0],complete={...partial,dailyReturn:.009588,returnSource:'腾讯基金',returnFrom:'2026-10-19',returnTo:partial.date};
 const frozen={model:{value:2},date:partial.date};
 const previous={actual:complete,forecast:frozen,originalForecast:frozen,firstForecastAt:'t1',firstActualSeenAt:'t2'};
 const next=reconcile(previous,null,partial,'t3');assert.equal(next.actual.dailyReturn,.009588);assert.equal(next.forecast,frozen);
 const main=mergePublishedNav(complete,{...partial,dailyReturn:.0096});assert.equal(main.dailyReturn,.0096);assert.equal(main.returnSource,undefined);
 assert.equal(mergePublishedNav(complete,{...partial,value:2.075}).dailyReturn,null,'净值修订不能保留旧涨跌');
});
