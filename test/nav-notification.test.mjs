import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function setup(saved={},testDone=false){
 const storage=new Map([['qdii-seen',JSON.stringify(saved)],['qdii-dot-test-20261016-cards',testDone?'done':'']]);let hover,badges=[],removedCount=0;
 const panel={addEventListener:(name,fn)=>{assert.equal(name,'mouseover');hover=fn;},querySelectorAll:()=>badges};
 const ctx=vm.createContext({localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},items:[],$:()=>panel});
 vm.runInContext(source.split('\n').find(l=>l.startsWith('const inFundGroup=')),ctx);
 vm.runInContext(source.slice(source.indexOf('let seenMap='),source.indexOf("let detailTab='chart';")),ctx);
 vm.runInContext(source.slice(source.indexOf("$('#funds').addEventListener('mouseover'"),source.indexOf("$('#funds').onclick=")),ctx);
 return {
  unseen:(fund,group='watch')=>{ctx.fund=fund;ctx.group=group;return vm.runInContext('unseen(fund,group)',ctx);},
  mark:(fund,group='watch')=>{ctx.fund=fund;ctx.group=group;vm.runInContext('markSeen(fund,group)',ctx);},
  saved:()=>JSON.parse(storage.get('qdii-seen')),
  initialize:funds=>{ctx.funds=funds;vm.runInContext('initializeReadState(funds)',ctx);},
  removedCount:()=>removedCount,
  enter(fund,{hasDot=true,inside=false,copies=1,group='watch'}={}){
   ctx.items=[fund];let removed=false;removedCount=0;
   badges=Array.from({length:copies},()=>({remove:()=>{removed=true;removedCount++;}}));
   const card={dataset:{cardGroup:group},contains:()=>inside,querySelector:selector=>selector==='.dot'?(hasDot?badges[0]:null):{dataset:{select:fund.code}}};
   hover({target:{closest:()=>card},relatedTarget:null});return removed;
  }
 };
}
const pending={code:'123456',date:'2026-10-15',latestNav:{date:'2026-10-14'},record:{}};

test('latest published NAV triggers a dot even while the observation date has no actual',()=>{
 const app=setup({'123456':{actual:'2026-10-13'}});
 assert.equal(app.unseen(pending),true);
 assert.equal(app.enter(pending),true,'hover alone clears the dot');
 assert.equal(app.saved()['watch:123456'].actual,'2026-10-14');
 assert.equal(app.unseen(pending),false);
 assert.equal(setup(app.saved()).unseen(pending),false,'read date survives a reload');
 assert.equal(app.unseen({...pending,latestNav:{date:'2026-10-15'}}),true,'next publication alerts again');
});

test('opening details records latest NAV without requiring a current actual',()=>{
 const app=setup({'123456':{actual:'2026-10-13'}});
 app.mark(pending);assert.equal(app.saved()['watch:123456'].actual,'2026-10-14');
 assert.equal(app.unseen(pending),false);
});

test('historical observations and partial stream data cannot move read dates backwards',()=>{
 const app=setup({'123456':{actual:'2026-10-14',holdings:'2026-06-30'}});
 app.mark({...pending,latestNav:{date:'2026-10-12'},record:{actual:{date:'2026-10-10'}},latestHoldings:{asOf:'2026-03-31'}});
 app.mark({code:'123456',record:{}});
 assert.deepEqual(app.saved()['watch:123456'],{actual:'2026-10-14',holdings:'2026-06-30'});
 assert.equal(app.unseen(pending),false);
});

test('current actual remains a fallback and the newest available publication wins',()=>{
 const app=setup({'123456':{actual:'2026-10-13'}});
 const current={code:'123456',record:{actual:{date:'2026-10-14'}}};
 assert.equal(app.unseen(current),true);
 app.mark({...current,latestNav:{date:'2026-10-12'}});
 assert.equal(app.saved()['watch:123456'].actual,'2026-10-14');
 assert.equal(app.unseen({...pending,record:{actual:{date:'2026-10-12'}}}),false);
 assert.equal(app.unseen({code:'123456',record:{}}),false);
});

test('holdings updates and leftover test flags cannot create a formal NAV dot',()=>{
 const app=setup({'123456':{actual:'2026-10-14',holdings:'2026-03-31',dotTestUnread:true}});
 const fund={...pending,latestHoldings:{asOf:'2026-06-30'}};
 assert.equal(app.unseen(fund),false);
 assert.equal(app.unseen({code:'123456',record:{}}),false);
 const next={...fund,latestNav:{date:'2026-10-15'}};
 assert.equal(app.unseen(next),true);
 assert.equal(app.enter(next,{inside:true}),false);
 assert.equal(app.unseen(next),true);
 app.enter(next,{copies:2});assert.equal(app.removedCount(),1);
 assert.equal(app.unseen(next),false);
});

test('funds without a read baseline retain their existing initial behavior',()=>{
 const app=setup();
 assert.equal(app.unseen(pending),false);
 assert.equal(app.enter(pending,{hasDot:false}),false);
 app.mark(pending);
 assert.equal(app.saved()['watch:123456'].actual,'2026-10-14');
 assert.equal(app.unseen({...pending,latestNav:{date:'2026-10-15'}}),true);
});

test('fresh installations never seed fake dots',()=>{
 assert.doesNotMatch(source,/initializeDotTest|const dotTestKey/);
 const app=setup();assert.equal(app.unseen(pending),false);
 assert.equal(app.unseen({code:'006337',bond:true,group:'held'}),false);
});

test('same fund held and bond cards keep independent dots through hover and reload',()=>{
 const fund={...pending,bond:true,group:'held'},app=setup({'123456':{actual:'2026-10-13'}});
 assert.equal(app.unseen(fund,'held'),true);assert.equal(app.unseen(fund,'bond'),true);
 app.enter(fund,{group:'held'});
 assert.equal(app.unseen(fund,'held'),false);assert.equal(app.unseen(fund,'bond'),true);
 const reload=setup(app.saved());
 assert.equal(reload.unseen(fund,'held'),false);assert.equal(reload.unseen(fund,'bond'),true);
 reload.enter(fund,{group:'bond'});assert.equal(reload.unseen(fund,'bond'),false);
 const next={...fund,latestNav:{date:'2026-10-15'}};
 assert.equal(reload.unseen(next,'held'),true);assert.equal(reload.unseen(next,'bond'),true);
});

test('watch and bond cards inherit legacy dates without sharing mutable read state',()=>{
 const fund={...pending,bond:true,group:'watch'},app=setup({'123456':{actual:'2026-10-13'}});
 app.mark(fund,'watch');
 assert.equal(app.unseen(fund,'watch'),false);assert.equal(app.unseen(fund,'bond'),true);
 assert.equal(app.saved()['123456'].actual,'2026-10-13');
 app.mark(fund,'bond');assert.equal(app.unseen(fund,'bond'),false);
});

test('card renderer and detail click handler carry the selected card category',async()=>{
 const app=setup({'123456':{actual:'2026-10-13'}}),fund={...pending,bond:true,group:'held'};
 let hover;const panel={addEventListener:(name,fn)=>hover=fn};
 const ctx=vm.createContext({items:[fund],$:s=>s==='#detailDialog'?{showModal(){}}:panel,
  loadDetailHistory(){},render(){},markSeen:(f,group)=>app.mark(f,group),
  unseen:(f,group)=>app.unseen(f,group),busy:false,holdingsBusy:false,sortMode:'manual',
  fundTypeClass:()=>'',esc:String,pct:String,color:()=>'',cardState:()=>''});
 vm.runInContext(source.slice(source.indexOf("$('#funds').onclick="),source.indexOf("$('#detailDialog').addEventListener")),ctx);
 const select={dataset:{select:fund.code},closest:()=>({dataset:{cardGroup:'bond'}})};
 await panel.onclick({target:{closest:selector=>selector==='[data-select]'?select:null}});
 assert.equal(app.unseen(fund,'bond'),false);assert.equal(app.unseen(fund,'held'),true);
 vm.runInContext(source.slice(source.indexOf('function fundCard('),source.indexOf('let cardTimer=')),ctx);
 ctx.fund=fund;
 const held=vm.runInContext("fundCard(fund,0,[fund],'held')",ctx);
 const bond=vm.runInContext("fundCard(fund,0,[fund],'bond')",ctx);
 assert.match(held,/data-card-group="held"/);assert.match(held,/class="dot"/);
 assert.match(bond,/data-card-group="bond"/);assert.doesNotMatch(bond,/class="dot"/);
});




test('retiring test dots establishes missing baselines and preserves real unread publications',()=>{
 const app=setup({'watch:123456':{dotTestUnread:true},'held:123456':{dotTestUnread:true,actual:'2026-10-13'}});
 const f={...pending,bond:true,group:'watch'};
 app.initialize([f]);assert.equal(app.unseen(f,'watch'),false);assert.equal(app.saved()['watch:123456'].dotTestUnread,undefined);
 assert.equal(app.unseen(f,'bond'),false);
 app.initialize([{...f,group:'held'}]);assert.equal(app.unseen(f,'held'),true,'a real newer NAV remains unread');
 const next={...f,latestNav:{date:'2026-10-15'}};app.initialize([next]);assert.equal(app.unseen(next,'watch'),true);
 assert.equal(setup(app.saved()).unseen(next,'watch'),true);
});
