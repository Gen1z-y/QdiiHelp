import type { FundItem, NavRow } from '@/types/fund';

/**
 * 图片导出：把基金预估/公布涨跌画成一张 PNG（含指数与汇率小块）。
 *
 * 逻辑迁移自旧页面 `#exportImage` 的处理函数：
 * - 排除债基、指数基金、联接基金与指定代码；
 * - 所有基金都有同一区间的正式涨跌时按公布涨跌排序，否则按预估排序；
 * - 国内假期且没有累计区间预估时，改走 shared 的假期导出绘制。
 */

export interface ExportMarketQuote {
  id: string;
  name: string;
  usdValue?: number | null;
  value?: number | null;
}

export interface ExportWindowQuote {
  date: string;
  from?: string | null;
  indices: ExportMarketQuote[];
  fx?: { value?: number | null; source?: string };
}

export interface ExportData {
  today: string;
  holiday: { dates: string[] } | null;
}

export interface ExportDeps {
  pct: (value?: number | null) => string;
  navPeriodLabel: (interval: unknown, fallback?: string) => string;
  navReturnValue: (row?: NavRow | null) => number | undefined;
  drawHolidayExport: (
    data: unknown,
    deps: { pct: unknown; document: Document; api: unknown },
  ) => Promise<HTMLCanvasElement>;
  document: Document;
}

const EXCLUDED_CODE = '019305';

/** 满足导出条件的基金：排除债基、指数与联接基金。 */
export function exportableFunds(items: FundItem[]): FundItem[] {
  return items.filter(
    (fund) =>
      fund.code !== EXCLUDED_CODE && !fund.bond && !fund.index && !fund.indexQuote && !/债|联接|指数/.test(fund.name),
  );
}

export async function buildExportImage(
  items: FundItem[],
  deps: ExportDeps,
  api: <T>(url: string, options?: RequestInit) => Promise<T>,
): Promise<{ dataUrl: string; holiday: boolean }> {
  await deps.document.fonts.ready;

  const holidayData = await api<ExportData>('/api/export-data');

  const selected = exportableFunds(items);
  if (holidayData.holiday && !selected.some((fund) => fund.navEstimate?.to)) {
    const canvas = await deps.drawHolidayExport(holidayData, {
      pct: deps.pct,
      document: deps.document,
      api,
    });
    return { dataUrl: canvas.toDataURL('image/png'), holiday: true };
  }

  const exportActual = (fund: FundItem) =>
    [fund.record?.actual, fund.latestNav].find(
      (row) => row?.date === (fund.navEstimate?.to ?? fund.date) && Number.isFinite(deps.navReturnValue(row)),
    ) ?? null;
  const actualKey = (fund: FundItem): string => {
    const row = exportActual(fund);
    return [
      row?.returnFrom ?? row?.previousDate ?? 'unknown-' + fund.code,
      row?.returnTo ?? row?.date ?? fund.date,
      'CNY',
    ].join(':');
  };
  const estimateKey = (fund: FundItem): string =>
    [fund.navEstimate?.from ?? 'unknown', fund.navEstimate?.asOf ?? fund.date, 'CNY'].join(':');

  const allActualUpdated =
    selected.every((fund) => Number.isFinite(deps.navReturnValue(exportActual(fund)))) &&
    new Set(selected.map(actualKey)).size === 1;
  const sameEstimatePeriod = new Set(selected.map(estimateKey)).size === 1;
  const mixedOfficialPeriods = new Set(selected.filter((fund) => exportActual(fund)).map(actualKey)).size > 1;

  const sortValue = (fund: FundItem): number => {
    const value = allActualUpdated ? deps.navReturnValue(exportActual(fund)) : fund.navEstimate?.return;
    return Number.isFinite(value) ? (value as number) : -Infinity;
  };
  selected.sort((left, right) => {
    const leftGroup = allActualUpdated ? '' : estimateKey(left);
    const rightGroup = allActualUpdated ? '' : estimateKey(right);
    if (leftGroup !== rightGroup) return leftGroup.localeCompare(rightGroup);
    return sortValue(left) === sortValue(right) ? 0 : sortValue(right) - sortValue(left);
  });

  const windows = [
    ...new Map(
      selected.map((fund) => {
        const window = {
          date: fund.navEstimate?.asOf ?? fund.date,
          ...(fund.navEstimate?.from ? { from: fund.navEstimate.from } : {}),
          target: fund.navEstimate?.to ?? fund.date,
          mode: fund.navEstimate?.mode,
        };
        return [JSON.stringify(window), window] as const;
      }),
    ).values(),
  ];
  const marketData = await api<{ items: ExportWindowQuote[] }>('/api/export-indices', {
    method: 'POST',
    body: JSON.stringify({ windows, currency: 'CNY' }),
  });

  const doc = deps.document;
  const canvas = doc.createElement('canvas');
  const scale = 2;
  const width = 1500;
  const rowHeight = 64;
  const marketHeight = windows.length * 90 + (!sameEstimatePeriod || mixedOfficialPeriods ? 28 : 0);
  const tableTop = 28 + marketHeight;
  const headerHeight = 48;
  const rowTop = tableTop + headerHeight;
  const height = rowTop + selected.length * rowHeight + 24;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context2d = canvas.getContext('2d');
  if (!context2d) throw new Error('无法创建绘图上下文');
  context2d.scale(scale, scale);
  context2d.fillStyle = '#ffffff';
  context2d.fillRect(0, 0, width, height);

  const write = (text: string, x: number, y: number, size = 18, fill = '#17365e'): void => {
    context2d.font = `${size}px "Microsoft YaHei", sans-serif`;
    context2d.fillStyle = fill;
    context2d.fillText(text, x, y);
  };

  let marketY = 24;
  if (!sameEstimatePeriod || mixedOfficialPeriods) {
    write('各基金收益区间不同或未确认，按预估区间分组；公布涨跌不能直接排名', 32, marketY, 16, '#62748c');
    marketY += 28;
  }
  for (const window of windows) {
    const quote = marketData.items.find(
      (item) => item.date === window.date && (item.from ?? null) === ((window as { from?: string }).from ?? null),
    );
    const blockHeight = 78;
    const gap = 12;
    const leftWidth = 300;
    const tileWidth = (width - 48 - leftWidth - 4 * gap) / 4;

    context2d.fillStyle = '#eef4ff';
    context2d.fillRect(24, marketY, leftWidth, blockHeight);
    const period = deps.navPeriodLabel({
      from: (window as { from?: string }).from,
      to: (window as { target: string }).target,
      mode: (window as { mode?: string }).mode ?? ((window as { from?: string }).from ? 'cumulative' : 'daily'),
    });
    write(period + ((window as { mode?: string }).mode === 'cumulative' ? '合计预估' : '预估'), 40, marketY + 31, 22);
    if (window.date < (window as { target: string }).target) {
      write('已计入到 ' + window.date + ' 的行情，尚未算完', 40, marketY + 58, 14, '#62748c');
    }

    ['IXIC', 'NDX', 'SPX'].forEach((id, index) => {
      const x = 24 + leftWidth + gap + index * (tileWidth + gap);
      const indexQuote = quote?.indices.find((item) => item.id === id);
      context2d.fillStyle = '#eef4ff';
      context2d.fillRect(x, marketY, tileWidth, blockHeight);
      write(indexQuote?.name ?? id, x + 14, marketY + 28, 18);
      const usd = indexQuote?.usdValue ?? null;
      const cny = indexQuote?.value ?? null;
      const half = tileWidth / 2;
      write('美', x + 14, marketY + 58, 12, '#62748c');
      write(
        deps.pct(usd),
        x + 30,
        marketY + 58,
        20,
        (usd ?? 0) > 0 ? '#bc324b' : (usd ?? 0) < 0 ? '#278363' : '#62748c',
      );
      write('人', x + half + 8, marketY + 58, 12, '#62748c');
      write(
        deps.pct(cny),
        x + half + 24,
        marketY + 58,
        20,
        (cny ?? 0) > 0 ? '#bc324b' : (cny ?? 0) < 0 ? '#278363' : '#62748c',
      );
    });

    const fx = quote?.fx;
    const fxX = 24 + leftWidth + gap + 3 * (tileWidth + gap);
    context2d.fillStyle = '#eef4ff';
    context2d.fillRect(fxX, marketY, tileWidth, blockHeight);
    write(fx?.source === '人民币中间价' ? '美元/人民币 · 中间价' : '美元/人民币 · 参考', fxX + 14, marketY + 28, 16);
    write(
      typeof fx?.value === 'number' && Number.isFinite(fx.value) ? deps.pct(fx.value) : '缺汇率',
      fxX + 14,
      marketY + 58,
      20,
      (fx?.value ?? 0) > 0 ? '#bc324b' : (fx?.value ?? 0) < 0 ? '#278363' : '#62748c',
    );
    marketY += blockHeight + gap;
  }

  const columns = [32, 190, 950, 1250];
  context2d.fillStyle = '#e9eff8';
  context2d.fillRect(24, tableTop, width - 48, headerHeight);
  ['基金代码', '基金名称', '预估涨跌', '公布涨跌'].forEach((label, index) =>
    write(label, columns[index], tableTop + 30),
  );

  selected.forEach((fund, index) => {
    const y = rowTop + index * rowHeight;
    const actualRow = exportActual(fund);
    context2d.fillStyle = index % 2 ? '#f7f5fa' : '#ffffff';
    context2d.fillRect(24, y, width - 48, rowHeight);
    write(fund.code, columns[0], y + 36);

    context2d.font = '18px "Microsoft YaHei", sans-serif';
    let line = '';
    const lines: string[] = [];
    for (const char of fund.name) {
      if (context2d.measureText(line + char).width > 550) {
        lines.push(line);
        line = char;
      } else line += char;
    }
    if (line) lines.push(line);
    lines.slice(0, 2).forEach((text, lineIndex) => write(text, columns[1], y + 30 + lineIndex * 24));

    const estimateValue = fund.navEstimate?.return;
    write(
      Number.isFinite(estimateValue) ? deps.pct(estimateValue) : '—',
      columns[2],
      y + 36,
      21,
      (estimateValue ?? 0) > 0 ? '#bc324b' : (estimateValue ?? 0) < 0 ? '#278363' : '#62748c',
    );

    const actualValue = deps.navReturnValue(actualRow);
    write(
      Number.isFinite(actualValue) ? deps.pct(actualValue) : '—',
      columns[3],
      y + 36,
      21,
      (actualValue ?? 0) > 0 ? '#bc324b' : (actualValue ?? 0) < 0 ? '#278363' : '#62748c',
    );

    if (fund.stale || fund.error) write('缓存 / 刷新异常', columns[0], y + 56, 12, '#a45d21');
    if (fund.modelError) write(fund.modelError.slice(0, 46), columns[1], y + rowHeight - 5, 11, '#a45d21');
  });

  // 单条对角线水印：低调但可辨识。
  context2d.save();
  context2d.translate(width / 2, height / 2);
  context2d.rotate((-20 * Math.PI) / 180);
  context2d.fillStyle = 'rgba(23,54,94,0.08)';
  context2d.font = `700 ${Math.min(96, Math.round(width / 14))}px "Microsoft YaHei", sans-serif`;
  context2d.textAlign = 'center';
  context2d.fillText('净值观察台 · QDII HELP', 0, 0);
  context2d.restore();
  context2d.textAlign = 'left';

  return { dataUrl: canvas.toDataURL('image/png'), holiday: false };
}
