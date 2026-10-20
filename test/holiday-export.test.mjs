import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {holidayWindow,holidayExport,forecastHistory,compoundComplete} from '../lib/holiday-export.mjs';
import {drawHolidayExport} from '../public/holiday-export.js';

test('法定休市触发假期表，连续假期周末保留，普通周末与节后不触发',()=>{
 for(const day of ['2026-10-01','2026-10-03','2026-10-04','2026-10-07'])assert.deepEqual(holidayWindow(day).dates,['2026-10-01','2026-10-02','2026-10-05','2026-10-06','2026-10-07']);
 for(const day of ['2026-09-30','2026-10-08','2026-10-10','2026-10-11','2027-10-01'])assert.equal(holidayWindow(day),null);
 assert.deepEqual(holidayWindow('2026-09-27').dates,['2026-09-25']);
});
const fund=(code,name='测试全球基金')=>({code,name});
const record=(value,actual=null)=>({forecast:{model:{dailyReturn:value,return:.9},calculatedAt:'2026-10-02T01:00:00Z'},actual});
test('假期按保存交易日取数，节前列不计累计，未来日期不计，缺日不填零',()=>{
 const records={'123456:2026-09-30':record(.5),'123456:2026-10-01':record(.011),'123456:2026-10-02':record(-.003),'123456:2026-10-05':record(.9),
 '654321:2026-10-01':record(.1),'222222:2026-10-01':record(.02),'222222:2026-10-02':record(.03)};
 const result=holidayExport([fund('123456'),fund('654321'),fund('222222'),{...fund('000001'),bond:true}],records,new Date('2026-10-05T01:00:00Z'));
 assert.equal(result.holiday.previous,'2026-09-30');assert.equal(result.holiday.asOf,'2026-10-02');
 assert.deepEqual(result.rows.map(r=>r.code),['222222','123456','654321']);
 assert.ok(Math.abs(result.rows[1].total-((1.011*.997)-1))<1e-12);
 assert.equal(result.rows[1].cells.find(c=>c.date==='2026-10-05').value,null);
 assert.equal(result.rows[2].total,null);assert.equal(result.rows[2].incomplete,true);
 assert.equal(compoundComplete([]),null);assert.equal(compoundComplete([{value:0}]),0);
});
test('假期表附美元/人民币单日参考行，缺日不填零，无汇率数据不显示该行',async()=>{
 const fxDisplay={'2026-10-01':{dailyReturn:.002},'2026-10-02':{dailyReturn:-.001}};
 const data=holidayExport([fund('123456')],{'123456:2026-10-01':record(.011),'123456:2026-10-02':record(-.003)},new Date('2026-10-03T03:00:00Z'),fxDisplay);
 const row=data.holiday.fxRow;
 assert.equal(row.name,'美元/人民币 单日');
 assert.equal(row.cells.find(c=>c.date==='2026-10-01').value,.002);
 assert.equal(row.cells.find(c=>c.date==='2026-10-05').value,null);
 assert.ok(Math.abs(row.total-((1.002*.999)-1))<1e-12);
 const labels=[],ctx={scale(){},save(){},restore(){},translate(){},rotate(){},fillRect(){},fillText(s){labels.push(s);},measureText(s){return {width:s.length*18};}};
 await drawHolidayExport(data,{pct:v=>(v*100).toFixed(2)+'%',document:{createElement:()=>({getContext:()=>ctx})},api:async()=>({items:[]})});
 assert.ok(labels.includes('美元/人民币 单日'));
 assert.ok(labels.includes('净值观察台 · QDII HELP'));
 assert.equal(holidayExport([fund('123456')],{'123456:2026-10-01':record(.011)},new Date('2026-10-03T03:00:00Z'),{}).holiday.fxRow,null);
});
test('节后实际回填不替换原预估，未记录不从实际或累计伪造单日',()=>{
 const records={'123456:2026-10-01':record(.01,{date:'2026-10-01',dailyReturn:.02}),
 '123456:2026-10-02':{forecast:{model:{return:.5}},actual:{dailyReturn:.03}}};
 const copy=JSON.stringify(records),history=forecastHistory(records,'123456');
 assert.equal(history[1].value,.01);assert.equal(history[1].actual,.02);assert.equal(history[0].value,null);
 holidayExport([fund('123456')],records,new Date('2026-10-03T03:00:00Z'));
 assert.equal(JSON.stringify(records),copy);
});
test('假期画布按交易日输出，指数置顶，无晚上更新列、无周末列',async()=>{
 const data=holidayExport([fund('123456')],{'123456:2026-10-01':record(.011),'123456:2026-10-02':record(-.003)},new Date('2026-10-03T03:00:00Z'));
 const labels=[],ctx={scale(){},save(){},restore(){},translate(){},rotate(){},fillRect(){},fillText(s){labels.push(s);},measureText(s){return {width:s.length*18};}};
 const canvas=await drawHolidayExport(data,{pct:v=>(v*100).toFixed(2)+'%',document:{createElement:()=>({getContext:()=>ctx})},api:async(url,{body})=>({items:JSON.parse(body).windows.map(w=>({...w,indices:['IXIC','NDX','SPX'].map(id=>({id,value:.01}))}))})});
 assert.ok(canvas.width>0);assert.ok(labels.includes('10/01'));assert.ok(labels.includes('10/07'));assert.ok(!labels.includes('10/03'));
 assert.ok(labels.indexOf('纳斯达克100')<labels.indexOf('测试全球基金'));
 assert.ok(labels.includes('0.80%'));assert.ok(!labels.some(s=>s.includes('晚上更新')));
 assert.ok(!labels.some(s=>/按假期累计|累计为假期|美股日期|未记录表示/.test(s)));
});
test('页面无自动日期开关与手动日期控件，全部请求固定自动',()=>{
 const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),js=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.ok(!html.includes('id="autoDate"'));assert.ok(!html.includes('id="date"'));assert.ok(!js.includes("$('#autoDate')"));assert.ok(!js.includes("$('#date')"));
});
