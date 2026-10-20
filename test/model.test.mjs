import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {movement,estimate,reconcile,previousWeekday,validDate} from '../lib/model.mjs';
import {parseHoldings} from '../lib/provider.mjs';
import {Store} from '../lib/store.mjs';
test('跨休市日选最近收盘且不读取未来价格',()=>{
  const s=[{date:'2026-09-23',close:100},{date:'2026-09-28',close:90},{date:'2026-09-29',close:500}];
  const r=movement(s,'2026-09-24','2026-09-28');assert.ok(Math.abs(r.return+.1)<1e-12);assert.equal(r.base.date,'2026-09-23');assert.equal(r.target.close,90);
});
test('韩元逆向中间价转换',()=>assert.ok(Math.abs(movement([{date:'2026-09-24',close:200},{date:'2026-09-28',close:220}],'2026-09-24','2026-09-28',true).return-(200/220-1))<1e-12));
test('权重不归一化，缺失部分不虚构收益',()=>{
  const m=estimate({value:2},[{weight:50,rmbReturn:(1.1*1.02)-1},{weight:10,rmbReturn:null}]);
  assert.ok(Math.abs(m.value-2.122)<1e-12);assert.equal(m.coverage,50);assert.equal(m.unknown,50);
  assert.equal(estimate({value:2},[{weight:10,rmbReturn:.5}]).value,2.1);
  assert.equal(estimate({value:2},[{weight:10,rmbReturn:null}]).value,null);
});
test('正式值公布后冻结原预测，不能用事后模型回填',()=>{
  const f={model:{value:2.1}},later={model:{value:2.2}},actual={value:2.15,date:'2026-09-28'};
  const pre=reconcile(null,f,null,'t1'),published=reconcile(pre,later,actual,'t2');
  assert.equal(published.forecast.model.value,2.1);assert.equal(published.firstForecastAt,'t1');
  assert.equal(reconcile(null,later,actual,'t2').forecast,null);
  assert.deepEqual(reconcile(published,later,null,'t3'),published);
});
test('失败的新模型不覆盖已有预测',()=>{
  const old=reconcile(null,{model:{value:2}},null,'t1');assert.equal(reconcile(old,{model:{value:null}},null,'t2').forecast.model.value,2);
});
test('默认日期按北京时间，周一回到周五',()=>{
  assert.equal(previousWeekday(new Date('2026-09-27T17:00:00Z')),'2026-09-25');assert.equal(validDate('2026-02-30'),false);
});
test('持仓解析兼容多列，不执行远程脚本',()=>{
  const html="<a title='测试基金'>测试基金</a>截止至：<font>2026-06-30</font><tbody><tr><td>1</td><td><a href='//quote.eastmoney.com/unify/r/105.NVDA'>NVDA</a></td><td>英伟达</td><td>--</td><td>9.38%</td></tr></tbody>";
  const result=parseHoldings('var apidata={content:'+JSON.stringify(html)+',curyear:2026};');assert.equal(result.rows[0].weight,9.38);assert.equal(result.rows[0].secid,'105.NVDA');assert.equal(result.asOf,'2026-06-30');
});
test('增删基金重启后保留，历史不随移除消失',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qdii-test-')),file=path.join(dir,'state.json');
  const s=new Store(file);s.add('000001');s.data.records.x={forecast:1};s.remove('018147');
  const loaded=new Store(file);assert.ok(loaded.data.watchlist.includes('000001'));assert.ok(!loaded.data.watchlist.includes('018147'));assert.equal(loaded.data.records.x.forecast,1);
  fs.rmSync(file);fs.rmdirSync(dir);
});
