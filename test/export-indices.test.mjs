import test from 'node:test';
import assert from 'node:assert/strict';
import {exportIndices} from '../lib/export-indices.mjs';
import {expectedCloseDate,session,shiftDate} from '../lib/calendar.mjs';
import {chinaDate,previousWeekday} from '../lib/model.mjs';

// Relative dates: the export window is limited to the last 100 days, so fixed
// dates silently expire and turn the suite red months after they were written.
const pw=d=>previousWeekday(new Date(d+'T12:00:00Z'));
const usDay=d=>expectedCloseDate(d,'US');
function recentTarget(){
 let target=usDay(pw(chinaDate()));
 for(let i=0;i<15&&usDay(pw(target))!==pw(target);i++)target=usDay(shiftDate(target,-1));
 return target;
}
function recentClosure(){
 let d=chinaDate();
 for(let i=0;i<15&&!session(d,'US').closed;i++)d=shiftDate(d,-1);
 return d;
}

test('三个指数分别按当日及累计区间叠加汇率，共享汇率请求',async()=>{
 const target=recentTarget(),base=pw(target),from=usDay(shiftDate(base,-1));
 assert.ok(from<base&&base<target,'window dates are ordered US trading days');
 const calls=[],rates=[];
 const quote=async(id,date,from2)=>{calls.push([id,date,from2]);return {date,baseDate:from2,close:id==='IXIC'?110:120,baseClose:100};};
 const fx=async(currency,f,t)=>{rates.push([currency,f,t]);return {return:.01,base:{date:f},target:{date:t}};};
 const result=await exportIndices([{date:target},{date:target,from}],{quote,fx});
 assert.equal(calls.length,6);assert.equal(rates.length,2);
 assert.deepEqual(calls[0],['IXIC',target,base]);
 assert.deepEqual(result.items[0].indices.map(r=>r.id),['IXIC','NDX','SPX']);
 assert.ok(Math.abs(result.items[0].fx.value-.01)<1e-10);assert.equal(result.items[0].fx.targetDate,target);
 assert.equal(result.items[1].fx.baseDate,from);assert.equal(rates.length,2);
 assert.ok(Math.abs(result.items[0].indices[0].value-.111)<1e-10);
 assert.ok(Math.abs(result.items[0].indices[0].usdValue-.10)<1e-10);
 assert.ok(Math.abs(result.items[1].indices[1].value-.212)<1e-10);
});

test('指数缺失或过期不展示错误数值，单个失败不阻塞其他指数',async()=>{
 const target=recentTarget(),base=pw(target);
 const quote=async(id,date)=>{if(id==='IXIC')throw Error('offline');return {date:id==='NDX'?'2026-01-02':date,baseDate:base,close:110,baseClose:100};};
 const result=await exportIndices([{date:target}],{currency:'USD',quote});
 assert.equal(result.items[0].indices[0].value,null);
 assert.equal(result.items[0].indices[1].value,null);
 assert.ok(result.items[0].indices[2].value>0);
 assert.equal(result.items[0].fx,null);
 assert.equal(result.items[0].indices[0].usdValue,null);
 await assert.rejects(exportIndices([{date:target,from:target}]),/日期/);
});

test('休市沿用收盘只计算该区间收益，不重复上一交易日涨跌',async()=>{
 const closure=recentClosure(),carried=usDay(shiftDate(closure,-1));
 assert.ok(carried<=pw(closure),'closure carries the preceding US trading day');
 const quote=async()=>({date:carried,baseDate:carried,close:110,baseClose:110});
 const result=await exportIndices([{date:closure}],{currency:'USD',quote});
 assert.equal(result.items[0].indices[0].value,0);
 assert.equal(result.items[0].indices[0].closed,true);
});
