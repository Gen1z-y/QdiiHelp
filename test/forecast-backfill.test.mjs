import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructForecast} from '../lib/forecast-backfill.mjs';
import {forecastHistory,holidayExport} from '../lib/holiday-export.mjs';
import {forecastStats} from '../lib/forecast-stats.mjs';

test('历史行情补算独立保存，不产生事前预测和准确率样本',async()=>{
 const row={weight:40,secid:'1.600000',currency:'CNY',rmbReturn:.03,dailyRmbReturn:.03,dailyBaseDate:'2026-09-29',stock:{base:{date:'2026-09-29'},target:{date:'2026-09-30'}},dailyStock:{base:{date:'2026-09-29'},target:{date:'2026-09-30'}}};
 const reconstruction=await reconstructForecast({date:'2026-09-30',name:'测试股票基金',holdings:{asOf:'2026-06-30',rows:[row]},nav:[{date:'2026-09-29',value:1}],rowWithPrices:async r=>r,now:new Date('2026-10-05T01:00:00Z')});
 assert.equal(reconstruction.dailyReturn,.012);assert.equal(reconstruction.method,'historical-backfill-v1');
 const records={'006373:2026-09-30':{reconstruction}};
 assert.equal(forecastHistory(records,'006373')[0].reconstructed,true);
 assert.equal(forecastStats('006373',records).pairedCount,0);
 const exported=holidayExport([{code:'006373',name:'测试股票基金'}],records,new Date('2026-10-05T01:00:00Z'));
 assert.equal(exported.rows[0].cells[0].value,.012);assert.equal(exported.rows[0].cells[0].reconstructed,true);
 records['006373:2026-09-30'].forecast={model:{dailyReturn:.02}};
 assert.equal(forecastHistory(records,'006373')[0].value,.02);assert.equal(forecastHistory(records,'006373')[0].reconstructed,false);
});
test('补算不能绕过未收盘和持仓过期规则',async()=>{
 const args={date:'2026-10-05',name:'测试股票基金',holdings:{asOf:'2023-06-30',rows:[]},nav:[],rowWithPrices:async r=>r,now:new Date('2026-10-05T01:00:00Z')};
 await assert.rejects(reconstructForecast(args),/尚未完成收盘/);
 await assert.rejects(reconstructForecast({...args,date:'2026-10-01'}),/190/);
});
