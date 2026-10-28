import test from 'node:test';
import assert from 'node:assert/strict';
import {bondReference} from '../lib/bond-reference.mjs';

const dates=[];for(let m=6;m<=9;m++)for(let d=1;d<=21;d++)dates.push(`2026-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
const treasury=i=>i===0?0:i%2?-0.0005:0.001;
const corpEx=i=>i%3?0.0002:-0.0003;
const convEx=i=>[0.004,-0.003,0.002,-0.002,0.001][i%5];
const corp=i=>treasury(i)+corpEx(i);
const conv=i=>treasury(i)+convEx(i);
const series=fn=>dates.map((date,i)=>({date,close:100+i,dayReturn:fn(i)}));
const quote=async symbol=>({'000012':series(treasury),'000013':series(corp),'000832':series(conv)}[symbol]);

test('多因子拟合区分利率信用转债敞口，目标日按因子折算',async()=>{
 // A pure rate fund: return moves exactly 2× the treasury factor only.
 const history={rows:dates.map((date,i)=>({date,dailyReturn:2*treasury(i)}))};
 const ref=await bondReference(dates.at(-1),{history,quote});
 assert.ok(Number.isFinite(ref.return),'reference computed');
 assert.ok(Math.abs(ref.return-2*treasury(dates.length-1))<1e-9,'rate beta 2 applied to treasury move');
 assert.ok(Math.abs(ref.coeffs[1]-2)<1e-6,'rate sensitivity recovered');
 assert.ok(Math.abs(ref.coeffs[2])<1e-6&&Math.abs(ref.coeffs[3])<1e-6,'no credit or convertible exposure invented');
 assert.ok(ref.r2>0.99);
 assert.equal(ref.samples,dates.length-1);
 assert.equal(ref.factors.length,3);
});

test('信用与转债敞口各自被识别，不同持仓得到不同敏感度',async()=>{
 // Credit fund: loads on the corporate−treasury spread; convertible fund on conv−treasury.
 const credit={rows:dates.map((date,i)=>({date,dailyReturn:treasury(i)+3*corpEx(i)}))};
 const refCredit=await bondReference(dates.at(-1),{history:credit,quote});
 assert.ok(Math.abs(refCredit.coeffs[1]-1)<1e-6&&Math.abs(refCredit.coeffs[2]-3)<1e-6&&Math.abs(refCredit.coeffs[3])<1e-6);
 const convertible={rows:dates.map((date,i)=>({date,dailyReturn:treasury(i)+0.5*convEx(i)}))};
 const refConv=await bondReference(dates.at(-1),{history:convertible,quote});
 assert.ok(Math.abs(refConv.coeffs[3]-0.5)<1e-6&&Math.abs(refConv.coeffs[2])<1e-6);
 assert.ok(Math.abs(refCredit.return-refConv.return)>1e-4,'same index day, different funds, different estimates');
});

test('样本不足或拟合质量差时返回不可用而非数字',async()=>{
 const fewDates=dates.slice(-3);
 const few=await bondReference(fewDates.at(-1),{history:{rows:fewDates.map((date,i)=>({date,dailyReturn:0.002}))},quote});
 assert.equal(few.return,null);assert.match(few.unavailable,/样本不足/);
 const noisy={rows:dates.map((date,i)=>({date,dailyReturn:i%2?0.002:-0.001}))};
 const bad=await bondReference(dates.at(-1),{history:noisy,quote:async symbol=>({'000012':series(()=>0.001),'000013':series(()=>-0.001),'000832':series(()=>0.002)}[symbol])});
 assert.equal(bad.return,null);assert.match(bad.unavailable,/拟合质量不足|历史波动不足/);
});

test('bond fit excludes target-day and future NAVs from training',async()=>{
 const target=dates[65],past=dates.slice(0,65).map((date,i)=>({date,dailyReturn:2*treasury(i)}));
 const contaminated=[...past,...dates.slice(65).map(date=>({date,dailyReturn:.5}))];
 const [a,b]=await Promise.all([bondReference(target,{history:{rows:past},quote}),bondReference(target,{history:{rows:contaminated},quote})]);
 assert.equal(b.samples,a.samples);assert.ok(Math.abs(b.return-a.return)<1e-12);assert.deepEqual(b.coeffs,a.coeffs);
});
