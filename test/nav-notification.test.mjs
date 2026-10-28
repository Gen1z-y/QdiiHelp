import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {estimateLabel,intervalNote} from '../public/forecast-details.js';

const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function setup(saved={},testDone=false){
 const storage=new Map([['qdii-seen',JSON.stringify(saved)],['qdii-dot-test-20261016-cards',testDone?'done':'']]);let hover,badges=[],removedCount=0;
 const panel={addEventListener:(name,fn)=>{assert.equal(name,'mouseover');hover=fn;},querySelectorAll:()=>badges};
 const ctx=vm.createContext({estimateLabel,intervalNote,localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},items:[],$:()=>panel});
 vm.runInContext(source.split('\n').find(l=>l.startsWith('const inFundGroup=')),ctx);
 vm.runInContext(source.slice(source.indexOf('let seenMap='),source.indexOf("let detailTab='overview';")),ctx);
 vm.runInContext(source.slice(source.indexOf("$('#funds').addEventListener('mouseover'"),source.indexOf("$('#funds').onclick=")),ctx);
 return {
  unseen:(fund,group='watch')=>{ctx.fund=fund;ctx.group=group;return vm.runInContext('unseen(fund,group)',ctx);},
  mark:(fund,group='watch')=>{ctx.fund=fund;ctx.group=group;vm.runInContext('markSeen(fund,group)',ctx);},
  saved:()=>JSON.parse(storage.get('qdii-seen')),
  render(fund,group='watch'){
   Object.assign(ctx,{fund,group,reliability:()=>({}),esc:String,num:String,
    pct:v=>Number.isFinite(v)?(v*100).toFixed(2)+'%':'—',calibrationBadge:()=>'',color:()=>'',fundTypeClass:()=>'',sortMode:'manual',busy:false,holdingsBusy:false});
   vm.runInContext(source.slice(source.indexOf('function cardState('),source.indexOf('let cardTimer=')),ctx);
   return vm.runInContext('fundCard(fund,0,[fund],group)',ctx);
  },
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
const pending={code:'123456',date:'2026-10-15',latestNav:{date:'2026-10-14',value:1,dailyReturn:0},record:{}};

test('latest published NAV triggers a dot even while the observation date has no actual',()=>{
 const app=setup({'123456':{actual:'2026-10-13'}});
 assert.equal(app.unseen(pending),true);
 assert.equal(app.enter(pending),true,'hover alone clears the dot');
 assert.equal(app.saved()['watch:123456'].actual,'2026-10-14');
 assert.equal(app.unseen(pending),false);
 assert.equal(setup(app.saved()).unseen(pending),false,'read date survives a reload');
 assert.equal(app.unseen({...pending,latestNav:{date:'2026-10-15',value:1,dailyReturn:0}}),true,'next publication alerts again');
});

test('opening details records latest NAV without requiring a current actual',()=>{
 const app=setup({'123456':{actual:'2026-10-13'}});
 app.mark(pending);assert.equal(app.saved()['watch:123456'].actual,'2026-10-14');
 assert.equal(app.unseen(pending),false);
});

test('historical observations and partial stream data cannot move read dates backwards',()=>{
 const app=setup({'123456':{actual:'2026-10-14',holdings:'2026-06-30'}});
 app.mark({...pending,latestNav:{date:'2026-10-12',value:1,dailyReturn:0},record:{actual:{date:'2026-10-10',value:1,dailyReturn:0}},latestHoldings:{asOf:'2026-03-31'}});
 app.mark({code:'123456',record:{}});
 assert.deepEqual(app.saved()['watch:123456'],{actual:'2026-10-14',holdings:'2026-06-30'});
 assert.equal(app.unseen(pending),false);
});

test('current actual remains a fallback and the newest available publication wins',()=>{
 const app=setup({'123456':{actual:'2026-10-13'}});
 const current={code:'123456',record:{actual:{date:'2026-10-14',value:1,dailyReturn:0}}};
 assert.equal(app.unseen(current),true);
 app.mark({...current,latestNav:{date:'2026-10-12',value:1,dailyReturn:0}});
 assert.equal(app.saved()['watch:123456'].actual,'2026-10-14');
 assert.equal(app.unseen({...pending,record:{actual:{date:'2026-10-12',value:1,dailyReturn:0}}}),false);
 assert.equal(app.unseen({code:'123456',record:{}}),false);
});

test('holdings updates and leftover test flags cannot create a formal NAV dot',()=>{
 const app=setup({'123456':{actual:'2026-10-14',holdings:'2026-03-31',dotTestUnread:true}});
 const fund={...pending,latestHoldings:{asOf:'2026-06-30'}};
 assert.equal(app.unseen(fund),false);
 assert.equal(app.unseen({code:'123456',record:{}}),false);
 const next={...fund,latestNav:{date:'2026-10-15',value:1,dailyReturn:0}};
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
 assert.equal(app.unseen({...pending,latestNav:{date:'2026-10-15',value:1,dailyReturn:0}}),true);
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
 const next={...fund,latestNav:{date:'2026-10-15',value:1,dailyReturn:0}};
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
 const ctx=vm.createContext({estimateLabel,intervalNote,items:[fund],$:s=>s==='#detailDialog'?{showModal(){}}:panel,
  loadDetailHistory(){},render(){},markSeen:(f,group)=>app.mark(f,group),
  unseen:(f,group)=>app.unseen(f,group),busy:false,holdingsBusy:false,sortMode:'manual',
  fundTypeClass:()=>'',esc:String,pct:String,calibrationBadge:()=>'',color:()=>'',cardState:()=>'',navReturnLabel:()=>'',navReturnDate:()=>'',navReturnValue:r=>r?.dailyReturn});
 vm.runInContext(source.slice(source.indexOf("$('#funds').onclick="),source.indexOf("$('#detailDialog').addEventListener")),ctx);
 const select={dataset:{select:fund.code},closest:()=>({dataset:{cardGroup:'bond'}})};
 await panel.onclick({target:{closest:selector=>selector==='[data-select]'?select:null}});
 assert.equal(ctx.detailTab,'overview');assert.equal(app.unseen(fund,'bond'),false);assert.equal(app.unseen(fund,'held'),true);
 vm.runInContext(source.slice(source.indexOf('function bondReferenceState('),source.indexOf('function hasPublishedReturn(')),ctx);
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
 const next={...f,latestNav:{date:'2026-10-15',value:1,dailyReturn:0}};app.initialize([next]);assert.equal(app.unseen(next,'watch'),true);
 assert.equal(setup(app.saved()).unseen(next,'watch'),true);
});

test('缺涨跌不亮点也不提前推进已读，同日补全后提醒且刷新保持',()=>{
 const partial={code:'123456',group:'watch',date:'2026-10-20',record:{actual:{date:'2026-10-20',value:2.107,dailyReturn:null}},latestNav:{date:'2026-10-20',value:2.107,dailyReturn:null}};
 const app=setup({'watch:123456':{actual:'2026-10-16'}});
 app.initialize([partial]);assert.equal(app.unseen(partial),false);
 assert.match(app.render(partial),/涨跌幅待补全/);assert.doesNotMatch(app.render(partial),/class="dot"/);
 app.mark(partial);assert.equal(app.saved()['watch:123456'].actual,'2026-10-16');
 const complete={...partial,record:{actual:{...partial.record.actual,dailyReturn:0}},latestNav:{...partial.latestNav,dailyReturn:0}};
 assert.equal(app.unseen(complete),true);assert.equal(setup(app.saved()).unseen(complete),true);
 app.mark(complete);assert.equal(app.unseen(complete),false);assert.equal(setup(app.saved()).unseen(complete),false);
});
test('旧版本已读过缺字段日期仍能在同日补全后提醒，各分类独立',()=>{
 const partial={code:'006337',bond:true,group:'held',date:'2026-10-20',latestNav:{date:'2026-10-20',value:1,dailyReturn:null}};
 const app=setup({'held:006337':{actual:'2026-10-20'},'bond:006337':{actual:'2026-10-20'}});
 app.initialize([partial]);const reload=setup(app.saved());
 const complete={...partial,latestNav:{...partial.latestNav,dailyReturn:0}};
 assert.equal(reload.unseen(complete,'held'),true);assert.equal(reload.unseen(complete,'bond'),true);
 reload.mark(complete,'held');assert.equal(reload.unseen(complete,'held'),false);assert.equal(reload.unseen(complete,'bond'),true);
});
test('区间补充结果显示日期范围和来源，不能伪装为单日正式涨跌',()=>{
 const actual={date:'2026-10-20',value:2.0744,dailyReturn:null,intervalReturn:.009588,returnFrom:'2026-10-16',returnTo:'2026-10-20',returnSource:'腾讯基金'};
 const fund={code:'123456',name:'测试基金',group:'watch',date:actual.date,record:{actual},latestNav:actual};
 const app=setup({'watch:123456':{actual:'2026-10-16'}});
 const html=app.render(fund);assert.match(html,/公布区间涨跌/);assert.match(html,/2026-10-16 → 2026-10-20/);
 assert.match(html,/腾讯基金/);assert.match(html,/0.96%/);assert.match(html,/class="dot"/);assert.doesNotMatch(html,/正式涨跌 · 2026-10-20/);
});

test('已核实假期后显示正式涨跌和原因，净值计算不冒充备用源核对',()=>{
 const actual={date:'2026-10-20',value:2.107,dailyReturn:null,intervalReturn:2.107/2.085-1,
  returnFrom:'2026-10-16',returnTo:'2026-10-20',returnSource:'公布净值计算',returnPeriod:'fund-valuation',returnReason:'重阳节'};
 const fund={code:'018147',name:'测试基金',group:'watch',date:actual.date,record:{actual},latestNav:actual};
 const app=setup({'watch:018147':{actual:'2026-10-16'}}),html=app.render(fund);
 assert.match(html,/正式涨跌/);assert.match(html,/1.06%/);assert.match(html,/2026-10-16 → 2026-10-20/);
 assert.match(html,/重阳节假期后公布/);assert.match(html,/由相邻公布净值计算/);assert.match(html,/class="dot"/);
 assert.doesNotMatch(html,/单日涨跌未公布|同日净值已核对/);
 app.mark(fund);assert.equal(app.unseen(fund),false);
 const cross={...fund,record:{actual:{...actual,returnSource:'腾讯基金'}}};
 assert.match(app.render(cross),/腾讯基金 · 同日净值已核对/);
});

test('单日正式涨跌只显示净值日期，不把上一净值日显示成区间',()=>{
 for(const dailyReturn of [.0079,0,-.0079]){
  const actual={date:'2026-10-23',previousDate:'2026-10-22',returnFrom:'2026-10-22',returnTo:'2026-10-23',value:1,dailyReturn,intervalReturn:.99};
  const fund={code:'005698',name:'测试基金',group:'watch',date:actual.date,record:{actual},latestNav:actual};
  const html=setup().render(fund);
  assert.match(html,/正式涨跌 · 2026-10-23/);
  assert.doesNotMatch(html,/正式涨跌 · 2026-10-22 → 2026-10-23/);
  assert.match(html,new RegExp((dailyReturn*100).toFixed(2).replace('.','\\.')+'%'));
 }
});

test('缺涨跌字段时也不把相邻净值日期伪装为区间收益',()=>{
 const actual={date:'2026-10-23',previousDate:'2026-10-22',value:1,dailyReturn:null};
 const fund={code:'005698',name:'测试基金',group:'watch',date:actual.date,record:{actual},latestNav:actual};
 const html=setup().render(fund);
 assert.match(html,/正式涨跌 · 2026-10-23/);
 assert.doesNotMatch(html,/2026-10-22 → 2026-10-23/);
});