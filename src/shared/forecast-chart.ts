const escape = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

const pct = (v: number | null | undefined): string =>
  ((Math.abs(v ?? 0) < 0.00005 ? 0 : (v as number)) * 100).toFixed(2) + '%';

export const historyRanges: [number, string][] = [
  [30, '近1月'],
  [90, '近3月'],
  [180, '近6月'],
  [365, '近1年'],
  [1095, '近3年'],
  [1825, '近5年'],
  [0, '成立以来'],
];

/** 图表的一个点：预估、公布、累计三种模式共用，未用到的字段留空。 */
export interface ChartPair {
  date: string;
  value?: number;
  officialNav?: boolean;
  cumulativeNav?: number;
  adjustment?: boolean;
  actual?: number | null;
  actualSource?: string;
  actualFrom?: string;
  actualTo?: string;
  intervalOnly?: boolean;
  forecast?: number | null;
  baseDate?: string;
  reference?: number | null;
  referenceFrom?: string;
  referenceTarget?: string;
  provisional?: boolean;
  cumulativeBaseDate?: string;
}

/** 官方历史净值行（/api/history 返回）。 */
export interface HistoryRow {
  date: string;
  value?: number;
  dailyReturn?: number | null;
  cumulativeNav?: number;
  adjustment?: boolean;
}

/** 已公布净值行（用于补齐图表缺口）。 */
export interface PublishedRow {
  date?: string;
  value?: number;
  dailyReturn?: number | null;
  intervalReturn?: number | null;
  returnFrom?: string;
  returnTo?: string;
  returnSource?: string;
  previousDate?: string;
  cumulativeNav?: number;
  adjustment?: boolean;
}

/** 刷新时保存的阶段参考（长假预估）。 */
export interface StageRow {
  date?: string;
  target?: string;
  from?: string;
  return?: number;
  referenceOnly?: boolean;
  provisional?: boolean;
  calculatedAt?: string;
}

export type ChartMode = 'periodic' | 'cumulative';

export interface CumulativeChartResult {
  rows: ChartPair[];
  base: string | null;
  incomplete: boolean;
  approximateCount: number;
}

export function cumulativeChartRows(pairs: ChartPair[]): CumulativeChartResult {
  const ordered = [...pairs].sort((a, b) => a.date.localeCompare(b.date));
  const baseline = ordered.find((r) => r.officialNav || Number.isFinite(r.actual));
  if (!baseline) return { rows: [], base: null, incomplete: false, approximateCount: 0 };
  const growthAt = new Map<string, number>([[baseline.date, 1]]);
  let growth = 1,
    broken = false,
    previousNav = baseline,
    approximateCount = 0;
  const rows = ordered
    .filter((r) => r.date >= baseline.date)
    .map((r) => {
      let actual: number | null = null;
      if (r.date === baseline.date) actual = 0;
      else if (Number.isFinite(r.actual) || r.officialNav) {
        let daily = r.actual,
          precise = false;
        if (
          (r.value ?? 0) > 0 &&
          (previousNav.value ?? 0) > 0 &&
          Number.isFinite(r.cumulativeNav) &&
          Number.isFinite(previousNav.cumulativeNav) &&
          !r.adjustment
        ) {
          const cash =
            (r.cumulativeNav as number) -
            (r.value as number) -
            ((previousNav.cumulativeNav as number) - (previousNav.value as number));
          if (cash >= -0.00001) {
            daily = ((r.value as number) + Math.max(0, cash)) / (previousNav.value as number) - 1;
            precise = true;
          }
        }
        if (!Number.isFinite(daily) || (daily as number) <= -1) broken = true;
        if (!broken) {
          growth *= 1 + (daily as number);
          actual = growth - 1;
          growthAt.set(r.date, growth);
          if (!precise) approximateCount++;
        }
        previousNav = r;
      }
      const base = growthAt.get(r.baseDate ?? '');
      const forecast =
        r.date > baseline.date &&
        (r.baseDate ?? '') < r.date &&
        Number.isFinite(base) &&
        Number.isFinite(r.forecast) &&
        (r.forecast as number) > -1
          ? (base as number) * (1 + (r.forecast as number)) - 1
          : null;
      const referenceBase = growthAt.get(r.referenceFrom ?? '');
      const reference =
        Number.isFinite(referenceBase) && Number.isFinite(r.reference)
          ? (referenceBase as number) * (1 + (r.reference as number)) - 1
          : null;
      return { ...r, actual, forecast, reference, cumulativeBaseDate: baseline.date };
    });
  return { rows, base: baseline.date, incomplete: broken, approximateCount };
}

// Display the already verified published result at its own NAV date. This
// fills chart gaps only; it never writes daily returns or accuracy samples.
export function publishedChartPairs(pairs: ChartPair[], publishedRows: PublishedRow[] = []): ChartPair[] {
  const merged = new Map<string, ChartPair>(pairs.map((r) => [r.date, { ...r }]));
  const candidates = publishedRows
    .filter((r): r is PublishedRow => !!r)
    .sort((a, b) => Number(Number.isFinite(b.dailyReturn)) - Number(Number.isFinite(a.dailyReturn)));
  for (const r of candidates) {
    const date = r.date ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(r.value) || (r.value as number) <= 0) continue;
    const actual = Number.isFinite(r.dailyReturn) ? (r.dailyReturn as number) : r.intervalReturn;
    if (!Number.isFinite(actual)) continue;
    const old: ChartPair = merged.get(date) ?? { date, forecast: null };
    merged.set(date, {
      ...old,
      actual: Number.isFinite(old.actual) ? (old.actual as number) : (actual as number),
      actualSource: old.actualSource ?? r.returnSource ?? '公布净值',
      actualFrom: old.actualFrom ?? r.returnFrom ?? r.previousDate,
      actualTo: r.returnTo ?? date,
      intervalOnly: old.intervalOnly ?? (!Number.isFinite(r.dailyReturn) && Number.isFinite(r.intervalReturn)),
    });
  }
  return [...merged.values()];
}

export function detailHistoryChart(
  pairs: ChartPair[],
  days = 90,
  mode: ChartMode = 'periodic',
  historyRows: HistoryRow[] = [],
  publishedRows: PublishedRow[] = [],
  stages: StageRow[] = [],
): string {
  if (mode !== 'cumulative') pairs = publishedChartPairs(pairs, publishedRows);
  const staged = new Map<string, ChartPair>(pairs.map((r) => [r.date, { ...r }]));
  for (const s of [...stages].sort((a, b) => (a.calculatedAt ?? '').localeCompare(b.calculatedAt ?? ''))) {
    const date = s.date ?? '';
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !s.from ||
      (date >= (s.target ?? '') && !s.referenceOnly) ||
      !Number.isFinite(s.return)
    )
      continue;
    staged.set(date, {
      ...(staged.get(date) ?? { date, forecast: null, actual: null }),
      reference: s.return,
      referenceFrom: s.from,
      referenceTarget: s.target,
      provisional: !!s.provisional,
    });
  }
  pairs = [...staged.values()];
  const end = [...pairs].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.date;
  const cutoff =
    end && days ? new Date(Date.parse(end + 'T12:00:00Z') - days * 86400000).toISOString().slice(0, 10) : '';
  let rows = pairs.filter((r) => r.date >= cutoff),
    extra = '';
  const cumulative = mode === 'cumulative';
  if (cumulative) {
    const merged = new Map<string, ChartPair>(rows.map((r) => [r.date, { ...r }]));
    for (const r of historyRows)
      if (end && r.date >= cutoff && r.date <= end)
        merged.set(r.date, {
          ...(merged.get(r.date) ?? { date: r.date, forecast: null }),
          actual: Number.isFinite(r.dailyReturn) ? (r.dailyReturn as number) : null,
          officialNav: (r.value ?? 0) > 0,
          value: r.value,
          cumulativeNav: r.cumulativeNav,
          adjustment: r.adjustment,
          actualSource: '官方历史净值',
        });
    const result = cumulativeChartRows([...merged.values()]);
    rows = result.rows;
    const last = rows.findLast((r) => Number.isFinite(r.actual));
    extra = result.base
      ? `<p class="historySummary">基准净值日 <strong>${escape(result.base)}</strong>　公布累计涨跌 <strong class="${(last?.actual ?? 0) > 0 ? 'up' : (last?.actual ?? 0) < 0 ? 'down' : ''}">${last ? pct(last.actual) : '—'}</strong>${last ? '（截至 ' + escape(last.date) + '）' : ''}</p>${result.approximateCount ? '<p class="muted">部分日期按公布日涨跌幅复合，存在舍入误差。</p>' : ''}${result.incomplete ? '<p class="note">部分公布日缺少有效涨跌幅，累计曲线在缺口后停止，等待数据补齐。</p>' : ''}`
      : '<p class="muted">暂无公布净值，无法计算累计涨跌。</p>';
  }
  return (
    '<div class="historyRangeBar"><h3 class="historyTitle">预估涨跌与公布涨跌</h3><div class="historyRanges" role="group" aria-label="历史时间范围">' +
    historyRanges
      .map(
        ([v, label]) =>
          `<button type="button" data-action="view" data-detail-days="${v}" aria-pressed="${days === v}">${label}</button>`,
      )
      .join('') +
    '</div><div class="historyRanges historyModes" role="group" aria-label="涨跌指标">' +
    (
      [
        ['periodic', '每期涨跌'],
        ['cumulative', '累计涨跌'],
      ] as [ChartMode, string][]
    )
      .map(
        ([v, label]) =>
          `<button type="button" data-action="view" data-history-mode="${v}" aria-pressed="${mode === v}">${label}</button>`,
      )
      .join('') +
    '</div></div>' +
    extra +
    forecastChart(rows, mode)
  );
}

type SeriesKey = 'reference' | 'forecast' | 'actual';

interface ChartSeries {
  key: SeriesKey;
  name: string;
  color: string;
}

const seriesValue = (r: ChartPair, key: SeriesKey): number | null => {
  const value = r[key];
  return typeof value === 'number' ? value : null;
};

export function forecastChart(pairs: ChartPair[], mode: ChartMode = 'periodic'): string {
  const cumulative = mode === 'cumulative';
  const series: ChartSeries[] = [
    { key: 'reference', name: cumulative ? '阶段累计参考' : '阶段区间参考', color: '#7c699d' },
    { key: 'forecast', name: cumulative ? '预估累计涨跌' : '预估涨跌', color: '#3266c5' },
    { key: 'actual', name: cumulative ? '公布累计涨跌' : '公布涨跌', color: '#ce7040' },
  ];
  const value = seriesValue;
  const ordered = [...pairs].sort((a, b) => a.date.localeCompare(b.date));
  const hasValue = (r: ChartPair): boolean => series.some((s) => Number.isFinite(value(r, s.key)));
  const first = ordered.findIndex(hasValue),
    last = ordered.findLastIndex(hasValue);
  // Trim empty endpoints while preserving gaps between real observations.
  const rows = first < 0 ? [] : ordered.slice(first, last + 1);
  const values = rows.flatMap((r) => series.map((s) => value(r, s.key))).filter((v): v is number => Number.isFinite(v));
  if (!values.length) return '<p class="muted">尚无可绘制的收盘或公布记录</p>';
  const lo = values.reduce((a, b) => Math.min(a, b), 0),
    hi = values.reduce((a, b) => Math.max(a, b), 0),
    pad = Math.max((hi - lo) * 0.15, 0.001),
    min = lo - pad,
    max = hi + pad;
  const width = 1000,
    right = width - 38;
  const x = (i: number): number => 64 + (rows.length === 1 ? (right - 64) / 2 : (i / (rows.length - 1)) * (right - 64)),
    y = (v: number): number => 240 - ((v - min) / (max - min)) * 210;
  let svg = `<svg width="100%" height="300" data-chart-width="${width}" viewBox="0 0 ${width} 300" role="img" aria-label="${cumulative ? '累计涨跌历史折线图' : '预估涨跌、公布涨跌历史折线图'}">`;
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4,
      py = y(v);
    svg += `<line x1="64" x2="${right}" y1="${py}" y2="${py}" stroke="#dce3ef"/><text x="55" y="${py + 4}" text-anchor="end" fill="#62748c" font-size="12">${pct(v)}</text>`;
  }
  const step = Math.max(1, Math.ceil(rows.length / 12)),
    dateStep = Math.max(1, Math.ceil((rows.length - 1) / 10));
  const multiYear = (rows[0]?.date ?? '').slice(0, 4) !== (rows.at(-1)?.date ?? '').slice(0, 4);
  rows.forEach((r, i) => {
    if ((i % dateStep === 0 && i <= rows.length - 1 - Math.max(1, dateStep * 0.7)) || i === rows.length - 1)
      svg += `<text x="${x(i)}" y="268" text-anchor="middle" fill="#62748c" font-size="12">${escape(multiYear ? r.date : r.date.slice(5))}</text>`;
  });
  for (const s of series) {
    let path = '',
      drawing = false;
    const lastPoint = rows.findLastIndex((r) => Number.isFinite(value(r, s.key)));
    rows.forEach((r, i) => {
      const v = value(r, s.key);
      if (!Number.isFinite(v)) {
        drawing = false;
        return;
      }
      path += (drawing ? ' L' : ' M') + x(i) + ' ' + y(v as number);
      drawing = true;
    });
    svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.5"/>`;
    rows.forEach((r, i) => {
      const v = value(r, s.key);
      if (!Number.isFinite(v)) return;
      const peers = series
        .filter((p) => Number.isFinite(value(r, p.key)))
        .sort((a, b) => (value(r, b.key) ?? 0) - (value(r, a.key) ?? 0));
      const rank = peers.findIndex((p) => p.key === s.key),
        offset = rank === 0 ? -12 : rank === 1 ? 20 : 36;
      const cumulativeBasis = cumulative ? ' · 累计基准净值日 ' + escape(r.cumulativeBaseDate) : '';
      const basis =
        cumulativeBasis +
        (s.key === 'forecast'
          ? ' · 净值日期 ' + escape(r.date) + (r.baseDate ? ' · 计算基准净值日 ' + escape(r.baseDate) + '' : '')
          : s.key === 'actual'
            ? ' · ' +
              escape(r.actualSource ?? '官方公布涨跌') +
              (r.actualFrom ? ' · 公布区间 ' + escape(r.actualFrom) + ' → ' + escape(r.actualTo ?? r.date) : '')
            : s.key === 'reference'
              ? ' · 参考区间 ' +
                escape(r.referenceFrom) +
                ' → ' +
                escape(r.date) +
                (r.provisional ? ' · 基准暂用预估' : '')
              : '');
      if (rows.length > 12 && i % step !== 0 && i !== lastPoint) return;
      svg += `<circle cx="${x(i)}" cy="${y(v as number)}" r="4" fill="${s.color}" tabindex="0"><title>${escape(r.date)} · ${s.name} ${pct(v)}${basis}</title></circle><text class="pointValue" x="${x(i)}" y="${Math.max(14, Math.min(255, y(v as number) + offset))}" text-anchor="middle" fill="${s.color}" font-size="12" font-weight="600" stroke="#f7f8fc" stroke-width="4" paint-order="stroke" aria-label="${escape(r.date)} ${s.name} ${pct(v)}">${pct(v)}</text>`;
    });
  }
  svg +=
    '<line class="forecastCursor" x1="0" x2="0" y1="25" y2="240" stroke="#8fa4c4" stroke-dasharray="4 4" visibility="hidden" pointer-events="none"/></svg>';
  const legend = series
    .map(
      (s) =>
        `<span><svg width="24" height="12" aria-hidden="true"><line x1="0" x2="24" y1="6" y2="6" stroke="${s.color}" stroke-width="3"/></svg> ${s.name}</span>`,
    )
    .join('　');
  return `<div class="forecastChart">${legend}<div class="forecastPlot" data-chart-values="${escape(JSON.stringify(rows.map((r) => ({ date: r.date, forecast: r.forecast ?? null, actual: r.actual ?? null, actualFrom: r.actualFrom, actualTo: r.actualTo, baseDate: r.baseDate, reference: r.reference ?? null, referenceFrom: r.referenceFrom }))))}" data-chart-mode="${mode}">${svg}<div class="forecastInspect" aria-live="polite">${inspectionLabel(rows.at(-1), mode)}</div><label class="forecastDateLabel">查看日期<input class="forecastDate" type="range" min="0" max="${rows.length - 1}" value="${rows.length - 1}" aria-label="选择日期查看图表数值"></label></div></div><p class="muted">${cumulative ? '所选范围内第一个公布净值日设为0%，优先用单位净值与累计净值处理现金分红、逐期复合；净值数据不足时使用公布日涨跌幅。预估累计涨跌以其基准日的公布累计收益衔接本次预估，不重复累加长假预估；缺少基准数据时留空。' : '对比每期预估和公布涨跌，查看具体点时核对起止区间。紫色为刷新时保存的阶段参考，中间日期没有正式净值时留空。时间按钮只筛选显示范围；长假期间，一次预估可能代表多天合计涨跌。'} 图表完整展示所选区间，指向日期或拖动下方日期滑块可查看具体数值。</p>`;
}

function inspectionLabel(row: ChartPair | undefined, mode: string): string {
  if (!row) return '';
  const cumulative = mode === 'cumulative';
  return (
    '<strong>' +
    escape(row.date) +
    '</strong>' +
    (row.actualFrom
      ? ' <small>公布区间 ' + escape(row.actualFrom) + ' → ' + escape(row.actualTo ?? row.date) + '</small>'
      : '') +
    '　<span class="inspectForecast">' +
    (cumulative ? '预估累计' : '预估涨跌') +
    ' ' +
    (Number.isFinite(row.forecast) ? pct(row.forecast) : '—') +
    '</span>　<span class="inspectActual">' +
    (cumulative ? '公布累计' : '公布涨跌') +
    ' ' +
    (Number.isFinite(row.actual) ? pct(row.actual) : '—') +
    '</span>' +
    (Number.isFinite(row.reference)
      ? '　<span>阶段参考 ' +
        pct(row.reference) +
        '（' +
        escape(row.referenceFrom) +
        ' → ' +
        escape(row.date) +
        '）</span>'
      : '')
  );
}

if (typeof document !== 'undefined') {
  const parsed = new WeakMap<HTMLElement, ChartPair[]>();
  function inspect(plot: HTMLElement, index: number): void {
    let rows = parsed.get(plot);
    if (!rows) {
      rows = JSON.parse(plot.dataset.chartValues ?? '[]') as ChartPair[];
      parsed.set(plot, rows);
    }
    const i = Math.max(0, Math.min(rows.length - 1, Math.round(index)));
    const label = plot.querySelector<HTMLElement>('.forecastInspect');
    if (label) label.innerHTML = inspectionLabel(rows[i], plot.dataset.chartMode ?? '');
    const slider = plot.querySelector<HTMLInputElement>('.forecastDate');
    if (slider) slider.value = String(i);
    const cursor = plot.querySelector<SVGLineElement>('.forecastCursor'),
      svg = plot.querySelector('svg'),
      width = Number(svg?.dataset.chartWidth);
    const px = 64 + (rows.length === 1 ? (width - 38 - 64) / 2 : (i / (rows.length - 1)) * (width - 38 - 64));
    cursor?.setAttribute('x1', String(px));
    cursor?.setAttribute('x2', String(px));
    cursor?.setAttribute('visibility', 'visible');
  }
  document.addEventListener('pointermove', (e) => {
    const target = e.target as Element | null;
    const svg = target?.closest('.forecastPlot>svg');
    if (!svg) return;
    const plot = svg.parentElement as HTMLElement | null;
    if (!plot) return;
    const box = svg.getBoundingClientRect(),
      slider = plot.querySelector<HTMLInputElement>('.forecastDate'),
      count = Number(slider?.max) + 1,
      width = Number((svg as unknown as { dataset: DOMStringMap }).dataset.chartWidth);
    inspect(plot, ((((e.clientX - box.left) / box.width) * width - 64) / (width - 38 - 64)) * (count - 1));
  });
  document.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement | null;
    if (!target?.matches?.('.forecastDate')) return;
    const plot = target.closest('.forecastPlot') as HTMLElement | null;
    if (plot) inspect(plot, Number(target.value));
  });
}
