import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function context(){
 const ctx=vm.createContext({sortMode:'manual',fundMatches:(f,q)=>!q||f.name.includes(q),sorters:{estimate:(a,b)=>b.navEstimate.return-a.navEstimate.return}});
 vm.runInContext(source.slice(source.indexOf('const inFundGroup='),source.indexOf('const fundTypeClass=')),ctx);return ctx;
}
const funds=[{code:'1',name:'普通基金',group:'watch',navEstimate:{return:.8}},
 {code:'2',name:'嘉实债券',group:'watch',bond:true,navEstimate:{return:.1}},
 {code:'3',name:'华夏基金',group:'watch',navEstimate:{return:.3}},
 {code:'4',name:'易方达基金',group:'watch',navEstimate:{return:.2}},
 {code:'5',name:'其他基金',group:'watch',navEstimate:{return:.9}},
 {code:'6',name:'普通持有',group:'held',bond:true},{code:'7',name:'华夏持有',group:'held',bond:true}];
test('自选名称优先且稳定排序，不改变持有/债基及原数组，搜索沿用优先规则',()=>{
 const ctx=context();ctx.funds=funds;
 const order=(g,q='')=>Array.from(vm.runInContext(`orderedGroupFunds(funds,'${g}','${q}').map(f=>f.code)`,ctx));
 assert.deepEqual(order('watch'),['2','3','4','1','5']);
 assert.deepEqual(order('held'),['6','7']);assert.deepEqual(order('bond'),['2','6','7']);
 assert.deepEqual(order('watch','基金'),['3','4','1','5']);assert.deepEqual(funds.map(f=>f.code),['1','2','3','4','5','6','7']);
 ctx.sortMode='estimate';assert.deepEqual(order('watch'),['5','1','3','4','2']);
});
test('自选箭头依展示顺序组内移动，优先区域边界不交换',async()=>{
 const ctx=context();ctx.items=funds.slice(0,5);ctx.sorting=false;ctx.busy=false;ctx.holdingsBusy=false;ctx.activeFundGroup='watch';
 const panel={};ctx.$=s=>s==='#funds'?panel:{value:''};let calls=0;ctx.api=async()=>{calls++;};ctx.render=()=>{};
 vm.runInContext(source.slice(source.indexOf("$('#funds').onclick="),source.indexOf("$('#detailDialog').addEventListener")),ctx);
 const move=(code,step)=>panel.onclick({target:{closest:s=>s==='[data-move]'?{dataset:{move:code,step:String(step),moveGroup:'watch'}}:null}});
 await move('4',1);assert.equal(calls,0,'不能越过优先区域边界');
 await move('3',-1);assert.equal(calls,1);
 assert.deepEqual(Array.from(vm.runInContext("orderedGroupFunds(items,'watch').map(f=>f.code)",ctx)),['3','2','4','1','5']);
});
