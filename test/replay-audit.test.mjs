import test from 'node:test';
import assert from 'node:assert/strict';
import {replaySealedForecasts,replayForecast} from '../lib/replay-audit.mjs';
import {estimateMarket} from '../lib/model.mjs';

const row={code:'A',secid:'105.A',weight:40,currency:'USD',
 stock:{base:{date:'2026-10-08',close:100},target:{date:'2026-10-09',close:101},return:.01},
 fx:{base:{date:'2026-10-08'},target:{date:'2026-10-09'},return:.002},
 dailyStock:{base:{date:'2026-10-08',close:100},target:{date:'2026-10-09',close:101},return:.01},
 dailyFx:{base:{date:'2026-10-08'},target:{date:'2026-10-09'},return:.002},
 dailyRmbReturn:.012,rmbReturn:.012};
const base={date:'2026-10-08',value:1};

test('封存预测用存档输入重算一致，篡改模型值被审计发现',()=>{
 const model={...estimateMarket(base,[row]),method:'market-close-v4'};
 const data={records:{'111111:2026-10-09':{sealedAt:'2026-10-10T00:00:00Z',forecast:{date:'2026-10-09',base,rows:[row],model}}}};
 const audit=replaySealedForecasts(data);
 assert.equal(audit.checked,1);assert.deepEqual(audit.mismatches,[]);
 data.records['111111:2026-10-09'].forecast.model.return+=0.01;
 const bad=replaySealedForecasts(data);
 assert.equal(bad.mismatches.length,1);
 assert.equal(bad.mismatches[0].key,'111111:2026-10-09');
});

test('未封存或不可回放的记录不参与审计',()=>{
 const model={...estimateMarket(base,[row]),method:'market-close-v4'};
 const data={records:{'111111:2026-10-09':{forecast:{date:'2026-10-09',base,rows:[row],model}},'222222:2026-10-09':{sealedAt:'x',forecast:{model:{method:'unknown'}}}}};
 const audit=replaySealedForecasts(data);
 assert.equal(audit.checked,1);assert.deepEqual(audit.mismatches,[]);
 assert.equal(replayForecast(data.records['222222:2026-10-09'].forecast),null);
});
