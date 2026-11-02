/** 假期导出用到的行情窗口（/api/export-indices 的返回）。 */
export interface HolidayExportIndexQuote {
  id: string;
  value?: number | null;
  closed?: boolean;
}

export interface HolidayExportQuote {
  date: string;
  indices: HolidayExportIndexQuote[];
}

/** 表格单元格：value 为空时显示 status 文案。 */
export interface HolidayExportCell {
  date: string;
  value: number | null;
  status: string;
  closed?: boolean;
}

export interface HolidayExportRow {
  name?: string;
  code?: string;
  cells: HolidayExportCell[];
  total?: number | null;
  incomplete?: boolean;
}

/** 假期分支的数据块（/api/export-data 的 holiday 部分）。 */
export interface HolidayExportHoliday {
  dates: string[];
  quoteDates: string[];
  completed: string[];
  start?: string;
  end?: string;
  asOf?: string;
  previous?: string;
  fxRow?: HolidayExportRow;
}

export interface HolidayExportData {
  holiday: HolidayExportHoliday;
  rows: HolidayExportRow[];
}

export interface HolidayExportDeps {
  api: <T>(url: string, options?: RequestInit) => Promise<T>;
  pct: (value?: number | null) => string;
  document: Document;
}

// Separate renderer: ordinary exports cannot accidentally inherit holiday totals.
export async function drawHolidayExport(
  data: HolidayExportData,
  { api, pct, document }: HolidayExportDeps,
): Promise<HTMLCanvasElement> {
  const { holiday, rows } = data,
    dates = holiday.dates;
  const windows = holiday.quoteDates.map((date) => ({ date }));
  const quotes = windows.length
    ? await api<{ items?: HolidayExportQuote[] }>('/api/export-indices', {
        method: 'POST',
        body: JSON.stringify({ windows, currency: 'CNY' }),
      })
    : { items: [] as HolidayExportQuote[] };
  const indices = (
    [
      ['IXIC', '纳斯达克综合'],
      ['NDX', '纳斯达克100'],
      ['SPX', '标普500'],
    ] as const
  ).map(([id, name]): HolidayExportRow => {
    const cells = dates.map((date): HolidayExportCell => {
      const q = quotes.items?.find((w) => w.date === date)?.indices.find((item) => item.id === id);
      return {
        date,
        value: q?.value ?? null,
        status: !holiday.quoteDates.includes(date) ? '待更新' : q?.closed ? '休市' : '缺行情',
        closed: q?.closed,
      };
    });
    const completed = cells.filter((c) => holiday.completed.includes(c.date));
    const usable = completed.length > 0 && completed.every((c) => Number.isFinite(c.value));
    const total = usable ? completed.reduce((v, c) => v * (1 + (c.value as number)), 1) - 1 : null;
    return { name, code: '指数参考 · 人民币', cells, total, incomplete: completed.length > 0 && total === null };
  });
  const all = [...indices, ...(holiday.fxRow ? [holiday.fxRow] : []), ...rows],
    nameWidth = 330,
    colWidth = 130,
    width = 48 + nameWidth + (dates.length + 1) * colWidth;
  const rowTop = 158,
    rowHeight = 66,
    height = rowTop + all.length * rowHeight + 24;
  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建导出画布');
  ctx.scale(2, 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const write = (s: string, x: number, y: number, size = 18, fill = '#17365e'): void => {
    ctx.font = `${size}px "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = fill;
    ctx.fillText(s, x, y);
  };
  const tint = (v: number | null | undefined): string =>
    Number(v) > 0 ? '#bc324b' : Number(v) < 0 ? '#278363' : '#62748c';
  const short = (d: string): string => d.slice(5).replace('-', '/');
  write('国内假期 · 每日预估', 24, 38, 27);
  write(
    (holiday.start ?? '') +
      ' — ' +
      (holiday.end ?? '') +
      '  |  日期按交易日  |  ' +
      (holiday.asOf ? '累计截至 ' + holiday.asOf : '等待首个交易日收盘'),
    24,
    69,
    16,
    '#62748c',
  );
  ctx.fillStyle = '#e9eff8';
  ctx.fillRect(24, 94, width - 48, 64);
  write('基金 / 指数', 40, 132);
  dates.forEach((d, i) => {
    const x = 24 + nameWidth + i * colWidth;
    write(short(d), x + 12, 123, 19);
    if (d === holiday.previous) write('节前待公布', x + 12, 147, 12, '#62748c');
  });
  write('假期累计', 24 + nameWidth + dates.length * colWidth + 10, 132);
  all.forEach((row, i) => {
    const y = rowTop + i * rowHeight;
    ctx.fillStyle = i < 4 ? '#eef4ff' : i % 2 ? '#f7f8fa' : '#fff';
    ctx.fillRect(24, y, width - 48, rowHeight);
    let name = row.name ?? '';
    ctx.font = '18px "Microsoft YaHei", sans-serif';
    while (ctx.measureText(name).width > nameWidth - 35) name = name.slice(0, -2) + '…';
    write(name, 40, y + 28);
    write(row.code ?? '', 40, y + 51, 12, '#62748c');
    row.cells.forEach((c, n) =>
      write(
        c.closed ? '休市' : Number.isFinite(c.value) ? pct(c.value) : c.status,
        24 + nameWidth + n * colWidth + 10,
        y + 37,
        Number.isFinite(c.value) ? 19 : 15,
        tint(c.value),
      ),
    );
    write(
      Number.isFinite(row.total) ? pct(row.total) : row.incomplete ? '数据不完整' : '待更新',
      24 + nameWidth + dates.length * colWidth + 10,
      y + 37,
      Number.isFinite(row.total) ? 19 : 15,
      tint(row.total),
    );
  });
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((-20 * Math.PI) / 180);
  ctx.fillStyle = 'rgba(23,54,94,0.08)';
  ctx.font = `700 ${Math.min(96, Math.round(width / 14))}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('净值观察台 · QDII HELP', 0, 0);
  ctx.restore();
  ctx.textAlign = 'left';
  return canvas;
}
