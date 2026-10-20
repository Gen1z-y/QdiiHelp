// Shared by the server and browser. All ages are relative to the valuation date.
export const MAX_HOLDINGS_AGE_DAYS=190;
export function holdingDateIssue(holdingsDate,date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(holdingsDate??'')||!Number.isFinite(Date.parse(holdingsDate))||new Date(holdingsDate).toISOString().slice(0,10)!==holdingsDate)return '缺少有效披露持仓日期，暂停股票预估';
 if(holdingsDate>date)return '当前持仓快照晚于目标日，不生成回溯预测';
 if(Date.parse(date)-Date.parse(holdingsDate)>MAX_HOLDINGS_AGE_DAYS*86400000)return `披露股票持仓超过${MAX_HOLDINGS_AGE_DAYS}天，暂停预估，等待有效持仓`;
 return null;
}
export const STOCK_ALLOCATION_ISSUE='最新资产配置股票占比为0，旧股票持仓不适用于当前基金；需补充基金投资或其他资产明细，暂停股票预估';
export const ESTIMATION_NOTE=`股票持仓超过${MAX_HOLDINGS_AGE_DAYS}天暂停预估；未覆盖资产不计贡献，覆盖率不代表准确率。`;
