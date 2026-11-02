import { pageRows, pagination } from './holdings-ui.ts';

const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

const pct = (v: number | null | undefined): string =>
  Number.isFinite(v) ? `${(v as number) > 0 ? '+' : ''}${((v as number) * 100).toFixed(2)}%` : '—';

const num = (v: number | null | undefined): string => (Number.isFinite(v) ? (v as number).toFixed(2) : '—');

/** 行情区间（股票或汇率），base→target 之间为一个区间的收益。 */
export interface LegLike {
  base?: { date?: string };
  target?: { date?: string };
  return?: number;
  source?: string;
}

/** 持仓行（估算明细）。 */
export interface ForecastStockRow {
  code?: string;
  name?: string;
  weight?: number;
  currency?: string;
  market?: string;
  rmbReturn?: number;
  dailyRmbReturn?: number;
  stock?: LegLike;
  dailyStock?: LegLike;
  fx?: LegLike | null;
  dailyFx?: LegLike | null;
  quoteSource?: string;
  marketStatus?: { state?: string; known?: boolean; message?: string } | null;
  error?: string | null;
  stale?: boolean;
  notes?: string[];
}

/** 指数行情（指数基金/指数近似模型）。 */
export interface IndexQuoteLike {
  id?: string;
  name?: string;
  date?: string;
  previousDate?: string;
  close?: number;
  baseClose?: number;
  previousClose?: number;
  valuationPreviousClose?: number;
  valuationPreviousQuoteDate?: string;
  baseDate?: string;
  source?: string;
  stale?: boolean;
  error?: string | null;
  marketStatus?: { state?: string; known?: boolean; message?: string } | null;
}

/** 估值区间（navEstimate）。 */
export interface NavEstimateLike {
  return?: number | null;
  from?: string;
  to?: string;
  asOf?: string;
  mode?: string;
  status?: string;
  partial?: boolean;
  referenceOnly?: boolean;
  provisional?: boolean;
  targetConfirmed?: boolean;
}

/** 一次预估（record.forecast / analysis）。 */
export interface ForecastLike {
  date?: string;
  asOf?: string;
  holdingsDate?: string;
  base?: { date?: string; value?: number };
  rows?: ForecastStockRow[];
  model?: { return?: number; dailyReturn?: number; coverage?: number; method?: string };
  indexQuote?: IndexQuoteLike | null;
  fx?: LegLike | null;
  dailyFx?: LegLike | null;
  calculatedAt?: string;
}

export interface PlanLike {
  target?: string;
  from?: string;
  asOf?: string;
  partial?: boolean;
  calendarKnown?: boolean;
  notices?: { date?: string; reason?: string; uncertain?: boolean }[];
  todayStatus?: { noValuation?: boolean; reason?: string };
  exposure?: { known?: boolean; timingComplete?: boolean };
}

export interface FundLike {
  code?: string;
  name?: string;
  date?: string;
  bond?: boolean;
  index?: boolean;
  indexQuote?: IndexQuoteLike | null;
  navEstimate?: NavEstimateLike | null;
  record?: { forecast?: ForecastLike | null; actual?: unknown; partialForecast?: ForecastLike | null } | null;
  analysis?: ForecastLike | null;
  plan?: PlanLike | null;
  stages?: { date?: string; target?: string; from?: string; return?: number; referenceOnly?: boolean }[];
  pendingPublications?: {
    date?: string;
    from?: string;
    asOf?: string;
    return?: number;
    partial?: boolean;
    referenceOnly?: boolean;
    provisional?: boolean;
  }[];
  marketProgress?: { name?: string; weight?: number; state?: string; quoteDates?: string[] }[];
  latestHoldings?: { asOf?: string } | null;
  modelError?: string | null;
  navWarning?: string | null;
  error?: string | null;
  stale?: boolean;
  fromSaved?: boolean;
  requestedDate?: string;
  refreshComplete?: boolean;
  domesticClosure?: { reason?: string; publishedDate?: string; today?: string } | null;
}

export interface ValidationPoint {
  date?: string;
  error: number;
}

export interface ValidationLike {
  points: ValidationPoint[];
  recentCount?: number;
  recentMae?: number;
  previousCount?: number;
  previousMae?: number;
  count?: number;
  from?: string;
  to?: string;
  rawMae?: number;
  correctedMae?: number;
  improvement?: number;
}

export interface StatsWindow {
  count?: number;
  limit?: number;
  bias?: number;
  mae?: number;
  direction?: number;
  from?: string;
  to?: string;
}

export interface StatsGroup {
  method?: string;
  windows?: StatsWindow[];
  validation?: ValidationLike;
}

export interface FundStatsLike {
  pairedCount?: number;
  groups?: StatsGroup[];
  excluded?: Record<string, number>;
}

/** 贡献行：在持仓行上补一个“对预估的影响”。 */
export interface ContributionRow extends ForecastStockRow {
  shownStock?: LegLike;
  shownFx?: LegLike | null;
  shownContribution?: number | null;
}

/** 汇率影响汇总。 */
export interface FxImpact {
  from: string;
  to: string;
  index: boolean;
  coverage: number;
  foreignWeight: number;
  contribution: number;
}

export function navPeriodLabel(interval: { to?: string; from?: string; mode?: string } = {}, fallback = ''): string {
  const to = interval.to ?? fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return '日期待确认';
  const format = (d: string): string => Number(d.slice(5, 7)) + '月' + Number(d.slice(8)) + '日';
  if (interval.mode !== 'cumulative' || !/^\d{4}-\d{2}-\d{2}$/.test(interval.from ?? '')) return format(to);
  const start = new Date(Date.parse((interval.from as string) + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  return start.slice(0, 7) === to.slice(0, 7)
    ? format(start) + '至' + Number(to.slice(8)) + '日'
    : format(start) + '至' + format(to);
}
export function estimateLabel(f: FundLike): string {
  const p = f.navEstimate;
  return p?.partial
    ? '阶段区间预估'
    : p?.referenceOnly
      ? '区间参考预估'
      : p?.mode === 'cumulative'
        ? '区间预估'
        : '预估涨跌';
}
export function intervalNote(f: FundLike): string {
  const p = f.navEstimate;
  if (!p?.from) return '';
  return (
    '基准 ' +
    p.from +
    ' · 行情截至 ' +
    (p.asOf ?? '待更新') +
    (p.targetConfirmed === false ? ' · 净值归属待确认' : '') +
    (f.plan?.todayStatus?.noValuation
      ? ' · 本基金今日不估值'
      : f.plan?.todayStatus?.reason === '周末休市'
        ? ' · 周末保留最近结果'
        : '') +
    (p.provisional ? ' · 基准净值暂用预估' : p.referenceOnly ? ' · 与目标单期区间可能不同' : '')
  );
}
export function observationPanel(f: FundLike): string {
  const pending = f.pendingPublications ?? [],
    stages = (f.stages ?? []).filter((s) => (s.date ?? '') < (s.target ?? '') || s.referenceOnly).slice(0, 15);
  const progress = f.marketProgress ?? [],
    notices = f.plan?.notices ?? [];
  return (
    '<section class="observationPanel"><h3>估值区间与公布进度</h3><p class="muted">' +
    esc(intervalNote(f) || '等待有效估值区间') +
    '</p>' +
    '<div class="observationBody"><div class="observationContext">' +
    (notices.length
      ? '<p class="note">' +
        esc(
          notices
            .map((n) => (n.date ?? '') + ' ' + (n.reason ?? '') + (n.uncertain ? '（暂停申赎，估值安排待确认）' : ''))
            .join('；'),
        ) +
        '</p>'
      : '') +
    (f.plan?.calendarKnown === false ? '<p class="note">目标年份交易日历未覆盖，日期安排待确认。</p>' : '') +
    (f.plan?.exposure?.known === false
      ? '<p class="muted">披露持仓的市场尚未全部识别，按保守收盘时间检查。</p>'
      : f.plan?.exposure?.timingComplete === false
        ? '<p class="muted">未覆盖资产可能涉及其他市场，按保守收盘时间检查。</p>'
        : '') +
    (progress.length
      ? '<div class="marketProgress">' +
        progress
          .map(
            (m) =>
              '<span class="marketProgressItem">' +
              esc(m.name) +
              ' · ' +
              num(m.weight) +
              '%<small>' +
              esc(
                m.state === 'pending'
                  ? '等待收盘'
                  : m.state === 'closed'
                    ? '休市，价格沿用'
                    : m.state === 'missing'
                      ? '行情缺失'
                      : m.state === 'unknown'
                        ? '市场待确认'
                        : '已过收盘时间',
              ) +
              (m.quoteDates?.length ? ' · 行情 ' + esc(m.quoteDates.join('、')) : '') +
              '</small></span>',
          )
          .join('') +
        '</div>'
      : '') +
    '<p class="muted">市场分布来自估算所用披露或跟踪标的，未覆盖资产及实际调仓可能不同。</p>' +
    '</div><div class="observationQueue">' +
    (pending.length
      ? '<details open><summary>待公布净值 · ' +
        pending.length +
        ' 期</summary><div class="tablewrap"><table><thead><tr><th>目标净值日</th><th>预估区间</th><th>预估涨跌</th><th>进度</th></tr></thead><tbody>' +
        pending
          .map(
            (p) =>
              '<tr><td>' +
              esc(p.date) +
              '</td><td>' +
              esc(p.from ?? '—') +
              ' → ' +
              esc(p.asOf ?? p.date) +
              '</td><td>' +
              pct(p.return) +
              '</td><td>' +
              esc(
                p.partial
                  ? '阶段预估'
                  : p.referenceOnly
                    ? '区间参考，等待公布'
                    : p.provisional
                      ? '基准净值待公布'
                      : '等待正式净值',
              ) +
              '</td></tr>',
          )
          .join('') +
        '</tbody></table></div></details>'
      : '<p class="muted">暂无已记录的待公布预估。</p>') +
    (stages.length
      ? '<details><summary>假期与阶段参考 · 最近 ' +
        stages.length +
        ' 条</summary><div class="tablewrap"><table><thead><tr><th>行情截至</th><th>基准净值日</th><th>区间参考</th><th>目标净值日</th></tr></thead><tbody>' +
        stages
          .map(
            (s) =>
              '<tr><td>' +
              esc(s.date) +
              '</td><td>' +
              esc(s.from) +
              '</td><td>' +
              pct(s.return) +
              '</td><td>' +
              esc(s.target) +
              (s.referenceOnly ? '（待确认）' : '') +
              '</td></tr>',
          )
          .join('') +
        '</tbody></table></div><p class="muted">刷新时记录的阶段参考，不是中间日期的正式收益；未刷新日期不补造预测。</p></details>'
      : '') +
    '</div></div></section>'
  );
}
export function dateStatus(
  f: FundLike,
  { automatic = true, now = new Date() }: { automatic?: boolean; now?: Date } = {},
): string {
  if (automatic && f.bond && f.domesticClosure) {
    const c = f.domesticClosure,
      label = c.reason === '周末休市' ? '周末休市' : '节假日期间';
    return c.publishedDate
      ? `${label} · 最近公布 ${c.publishedDate}${c.publishedDate === c.today ? '，已获取新净值' : '；暂无新公布净值'}`
      : `${label} · 暂无可用公布净值`;
  }
  if (f.fromSaved && f.requestedDate && f.requestedDate !== f.date)
    return `本机历史结果 · ${f.date}；${f.refreshComplete ? '暂无' : '正在获取'} ${f.requestedDate} 的数据`;
  const interval = f.navEstimate;
  if (interval?.asOf) {
    const kind = navPeriodLabel(interval) + (interval.mode === 'cumulative' ? '合计预估' : '预估');
    const status =
      interval.status === 'published'
        ? '基金公司已公布，可核对'
        : interval.partial
          ? '还没算完，目前计入到 ' + interval.asOf + ' 的行情'
          : interval.status === 'sealed'
            ? '预估已保存，等基金公司公布'
            : interval.referenceOnly
              ? '区间参考，等待正式基准或估值安排确认'
              : '正在等数据补齐';
    return kind + '。' + status + '。' + (interval.provisional ? '起点净值还没公布，金额暂按预估计算。' : '');
  }
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const weekend = [0, 6].includes(new Date(today + 'T12:00:00Z').getUTCDay());
  const previous = new Date(today + 'T12:00:00Z');
  do {
    previous.setUTCDate(previous.getUTCDate() - 1);
  } while ([0, 6].includes(previous.getUTCDay()));
  const date = f.date ?? '—',
    forecast = f.record?.forecast;
  const state = f.record?.actual ? '正式涨跌已公布' : forecast ? '收盘估算' : '等待数据';
  const prefix = !automatic ? '手选日期' : '本次净值日期';
  const note =
    automatic && !f.bond && weekend && date === previous.toISOString().slice(0, 10) ? '；周末不新增单日预估' : '';
  return `${prefix} · ${date} ${state}${note}`;
}
export function quoteStatusBadge(row: ForecastStockRow): string {
  const status = row.marketStatus;
  let tone = 'unknown',
    label = '暂无行情';
  if (status?.state === 'pending') {
    tone = 'pending';
    label = '待收盘';
  } else if (row.error) {
    tone = 'error';
    label = '行情异常';
  } else if (row.stale) {
    tone = 'pending';
    label = '上次的行情';
  } else if (status?.state === 'closed') {
    tone = 'closed';
    label = '正常休市';
  } else if (Number.isFinite(row.rmbReturn)) {
    tone = 'complete';
    label = '行情可用';
  } else if (status?.state === 'complete' && status.known === false) {
    label = '休市安排待确认';
  } else if (status?.state === 'complete' || Number.isFinite(row.rmbReturn)) {
    tone = 'complete';
    label = Number.isFinite(row.rmbReturn) ? '行情可用' : '已过收盘时间';
  }
  const detail = row.error || status?.message || (row.stale ? '使用缓存，等待更新' : '');
  return `<span class="quoteStatus quoteStatus-${tone}" title="${esc(detail)}">${label}</span>${detail ? ` <span class="quoteStatusText quoteStatusText-${tone}">${esc(detail)}</span>` : ''}`;
}
export function quoteStatusTone(row: ForecastStockRow): string {
  return /quoteStatus-(complete|closed|pending|error|unknown)/.exec(quoteStatusBadge(row))?.[1] ?? 'unknown';
}
export function quoteStatusLegend(active = 'all'): string {
  return (
    '<div class="quoteStatusLegend" role="group" aria-label="筛选持仓行情状态">' +
    (
      [
        ['all', '全部'],
        ['complete', '行情可用'],
        ['closed', '正常休市'],
        ['pending', '等收盘 / 上次行情'],
        ['error', '行情异常'],
        ['unknown', '暂无数据 / 休市安排待确认'],
      ] as [string, string][]
    )
      .map(
        ([tone, label]) =>
          `<button type="button" class="quoteStatus quoteStatus-${tone}" data-quote-filter="${tone}" aria-pressed="${tone === active}">${label}</button>`,
      )
      .join('') +
    '</div>'
  );
}
function validationPanel(groups: StatsGroup[], labels: Record<string, string>): string {
  return groups
    .filter((g) => g.validation)
    .map((g) => {
      const v = g.validation as ValidationLike,
        max = Math.max(0.01, ...v.points.map((p) => Math.abs(p.error)));
      const points = v.points
        .map(
          (p, i) =>
            (15 + (i * 370) / Math.max(1, v.points.length - 1)).toFixed(1) +
            ',' +
            (65 - (p.error / max) * 45).toFixed(1),
        )
        .join(' ');
      return (
        '<section class="calibrationValidation"><h4>' +
        esc(labels[g.method ?? ''] ?? g.method) +
        ' · 后续样本验证</h4><p>最近 ' +
        v.recentCount +
        ' 次平均误差 ' +
        num(v.recentMae) +
        ' 个百分点；此前 ' +
        v.previousCount +
        ' 次 ' +
        num(v.previousMae) +
        ' 个百分点。</p><svg class="errorTrend" viewBox="0 0 400 130" role="img" aria-label="近期预估误差，横轴从早到晚，零线上方为预估偏高"><line x1="10" y1="65" x2="390" y2="65" stroke="#a7adb7"/><polyline points="' +
        points +
        '" fill="none" stroke="#526da1" stroke-width="2"/>' +
        v.points
          .map(
            (p, i) =>
              '<circle cx="' +
              (15 + (i * 370) / Math.max(1, v.points.length - 1)).toFixed(1) +
              '" cy="' +
              (65 - (p.error / max) * 45).toFixed(1) +
              '" r="3" fill="#526da1"><title>' +
              esc(p.date) +
              '：' +
              num(p.error) +
              ' 个百分点</title></circle>',
          )
          .join('') +
        '<text x="12" y="122" font-size="10">' +
        esc(v.points[0]?.date ?? '') +
        '</text><text x="388" y="122" text-anchor="end" font-size="10">' +
        esc(v.points.at(-1)?.date ?? '') +
        '</text><text x="12" y="13" font-size="10">纵轴 ±' +
        num(max) +
        ' 个百分点 · 0为一致</text></svg>' +
        (v.count
          ? '<p>用此前10–30次已知结果校准，逐次检验后续 ' +
            v.count +
            ' 个样本（' +
            esc(v.from) +
            ' 至 ' +
            esc(v.to) +
            '）：原预估平均误差 <strong>' +
            num(v.rawMae) +
            '</strong>，校准后 <strong>' +
            num(v.correctedMae) +
            '</strong> 个百分点。</p><p>' +
            ((v.improvement ?? 0) > 0 ? '这批样本中校准误差较小' : '这批样本中校准未降低误差') +
            '；不保证未来效果。</p>'
          : '<p class="muted">尚无足够的后续样本；每个待检验样本至少需要此前10次已经获知正式值的同模型记录。</p>') +
        '<p class="muted">校准只使用计算当时已知的公布结果，主预估和封存记录保持原值。历史平均误差不是置信区间。</p></section>'
      );
    })
    .join('');
}
export function accuracyPanel(stats?: FundStatsLike | null): string {
  const groups = stats?.groups ?? [],
    excluded = stats?.excluded ?? {};
  const labels: Record<string, string> = {
    'market-close-v4': '按更多已公布持仓估算',
    'market-close-v3': '按前十大持仓估算',
    'market-close-v2': '按持仓估算（旧版）',
    'index-proxy-v3': '按指数估算',
    'index-proxy-v2': '按指数估算（旧版）',
    'bond-fit-v1': '原三指数拟合（债基）',
    'bond-fit-v2': '持仓约束滚动拟合（债基）',
  };
  const w0 = groups[0]?.windows?.[0];
  const headline =
    w0 && (w0.count ?? 0) >= 10
      ? `<p class="note">近 ${w0.count} 次对比：预估平均相差 ${num(w0.mae)} 个百分点，${(w0.bias ?? 0) > 0.005 ? '整体偏高' : (w0.bias ?? 0) < -0.005 ? '整体偏低' : '无明显高低偏差'} ${num(Math.abs(w0.bias ?? 0))} 个百分点，涨跌方向猜对 ${Number.isFinite(w0.direction) ? ((w0.direction as number) * 100).toFixed(0) + '%' : '—'}。这是该基金的历史表现，仅提示，不修改任何预估。</p>`
      : '';
  return `<section class="accuracyPanel"><h3>预估准不准 · 已对比 ${stats?.pairedCount ?? 0} 次</h3><p class="muted">把同一段时间的预估与正式结果对比。例如预估涨2%、实际涨1%，就差1个百分点。记录少时，还不能判断准不准。</p>${headline}${groups.length ? `<div class="tablewrap"><table><thead><tr><th>估算方法</th><th>最多对比次数</th><th>已对比次数</th><th>平均相差（百分点）</th><th>平均偏高 / 偏低（百分点）</th><th>涨跌方向猜对比例</th></tr></thead><tbody>${groups.flatMap((g) => (g.windows ?? []).map((w) => `<tr><td>${esc(labels[g.method ?? ''] ?? g.method)}</td><td>${w.limit} 个<small>${esc(w.from ?? '—')} → ${esc(w.to ?? '—')}</small></td><td>${w.count}${(w.count ?? 0) < (w.limit ?? 0) ? '（记录还少）' : ''}</td><td>${num(w.mae)}</td><td>${num(w.bias)}</td><td>${Number.isFinite(w.direction) ? ((w.direction as number) * 100).toFixed(1) + '%' : '—'}</td></tr>`)).join('')}</tbody></table></div>` : '<p class="muted">还没有足够的预估和正式结果可以对比。</p>'}${validationPanel(groups, labels)}<details><summary>哪些记录没有参与对比？</summary><p class="muted">没有计入：缺预测或公布值 ${excluded.unpaired ?? 0} 条；比较的日期不一致或缺少起点净值 ${excluded.interval ?? 0} 条；无法确认是否在公布前保存 ${excluded.timestamp ?? 0} 条；其他无效 ${excluded.invalid ?? 0} 条。保留原记录，不用已公布结果补造预估。</p></details></section>`;
}
export function contributionRows(rows: ForecastStockRow[], mode = 'daily'): ContributionRow[] {
  return rows
    .map((r) => {
      const daily = mode === 'daily',
        stock = daily ? r.dailyStock : r.stock,
        fx = daily ? r.dailyFx : r.fx;
      const ret = daily ? r.dailyRmbReturn : r.rmbReturn;
      return {
        ...r,
        shownStock: stock,
        shownFx: fx,
        shownContribution:
          Number.isFinite(ret) && Number.isFinite(r.weight) ? ((r.weight as number) / 100) * (ret as number) : null,
      };
    })
    .sort(
      (a, b) =>
        (Number.isFinite(b.weight) ? (b.weight as number) : -Infinity) -
        (Number.isFinite(a.weight) ? (a.weight as number) : -Infinity),
    );
}
export function indexContributionRows(forecast?: ForecastLike | null): ContributionRow[] {
  const q = forecast?.indexQuote;
  if (!q) return [];
  const dailyBase = q.valuationPreviousClose ?? q.previousClose,
    dailyDate = q.valuationPreviousQuoteDate ?? q.previousDate;
  return [
    {
      name: q.name ?? q.id,
      code: q.id,
      weight: 100,
      quoteSource: q.source,
      marketStatus: q.marketStatus,
      error: q.error,
      stale: q.stale,
      stock: {
        base: { date: q.baseDate },
        target: { date: q.date },
        return: (q.close as number) / (q.baseClose as number) - 1,
      },
      dailyStock: {
        base: { date: dailyDate },
        target: { date: q.date },
        return: (q.close as number) / (dailyBase as number) - 1,
      },
      fx: forecast?.fx,
      dailyFx: forecast?.dailyFx,
      rmbReturn: forecast?.model?.return,
      dailyRmbReturn: forecast?.model?.dailyReturn,
    },
  ];
}
export function contributionPanel(
  rows: ForecastStockRow[],
  mode = 'daily',
  holdingsDate?: string | null,
  page = 1,
  filter = 'all',
): string {
  if (!rows.length) return '';
  const daily = mode === 'daily',
    paged = pageRows(
      contributionRows(rows, mode).filter((r) => filter === 'all' || quoteStatusTone(r) === filter),
      page,
    );
  return `<h3>哪些股票影响了涨跌 · ${esc(holdingsDate ?? '—')}</h3><div class="contributionControls" role="group" aria-label="贡献区间"><button data-action="view" data-contribution="daily" aria-pressed="${daily}">只看一天</button><button data-action="view" data-contribution="cumulative" aria-pressed="${!daily}">看这段时间合计</button></div><p class="muted">${daily ? '查看最近一天的影响' : '查看本次预估这段时间的影响'}，按占基金比例从高到低排列。缺数据的地方留空；正数表示拉高预估，负数表示拉低预估。</p>${quoteStatusLegend(filter)}<div class="tablewrap"><table class="contributionTable"><thead><tr><th>股票 / 行情状态</th><th>占基金比例</th><th>${daily ? '单日' : '区间'}股价涨跌</th><th>汇率变动</th><th>对预估的影响（百分点）</th></tr></thead><tbody>${paged.rows.map((r) => `<tr><td>${esc(r.name)}<small>${esc(r.code)} · ${esc(r.shownStock ? (r.shownStock.base?.date ?? '') + ' → ' + (r.shownStock.target?.date ?? '') : '缺少该区间行情')}<br>${esc(r.quoteSource ?? '')}<br>${quoteStatusBadge(r)}${r.notes?.length ? '<br>' + esc(r.notes.join('；')) : ''}${r.shownFx?.target ? '<br>汇率 ' + esc(r.shownFx.base?.date) + ' → ' + esc(r.shownFx.target.date) : ''}</small></td><td>${num(r.weight)}%</td><td class="${(r.shownStock?.return ?? 0) > 0 ? 'up' : (r.shownStock?.return ?? 0) < 0 ? 'down' : ''}"><span class="changeValue">${pct(r.shownStock?.return)}</span></td><td class="${(r.shownFx?.return ?? 0) > 0 ? 'up' : (r.shownFx?.return ?? 0) < 0 ? 'down' : ''}"><span class="changeValue">${pct(r.shownFx?.return)}</span></td><td class="${(r.shownContribution ?? 0) > 0 ? 'up' : (r.shownContribution ?? 0) < 0 ? 'down' : ''}"><span class="changeValue">${num(Number.isFinite(r.shownContribution) ? (r.shownContribution as number) * 100 : null)}</span></td></tr>`).join('')}</tbody></table></div>${paged.rows.length ? '' : '<p class="muted">此状态下没有持仓。</p>'}${pagination(paged, 'contribution')}`;
}

export function forecastInputs(f: FundLike): ForecastLike | null {
  return f.record?.forecast ?? (!f.record?.actual ? f.record?.partialForecast : null) ?? f.analysis ?? null;
}

export function reliability(f: FundLike): {
  attention: boolean;
  issues: string[];
  holdingDate?: string;
  coverage?: number;
} {
  const issues: string[] = [],
    forecast = forecastInputs(f);
  const rows = forecast?.rows ?? [];
  const holdingDate = forecast?.holdingsDate ?? f.latestHoldings?.asOf;
  // Match the estimate shown in the summary, including its saved input snapshot.
  const coverage = forecast?.model?.coverage;
  if (f.error || f.stale) issues.push(f.error ? '刷新异常，' + (f.stale ? '沿用旧结果' : '暂不可用') : '沿用旧结果');
  if (f.navWarning) issues.push('公布净值来源存在差异');
  if (f.navEstimate?.partial) issues.push('阶段累计尚未完整');
  if (f.navEstimate?.provisional) issues.push('起点净值尚未确认');
  const waitingNormally = f.bond && /等待A股收盘确认|国内休市/.test(f.modelError ?? '');
  if (f.modelError && !f.record?.actual && !waitingNormally) issues.push(f.modelError);
  if (!f.bond && !f.index && !f.indexQuote) {
    if (!holdingDate) issues.push('缺少披露持仓');
    if (Number.isFinite(coverage) && (coverage as number) < 50) issues.push('有效资产覆盖不足50%');
    const age = holdingDate && f.date ? (Date.parse(f.date) - Date.parse(holdingDate)) / 86400000 : null;
    if ((age ?? 0) > 190) issues.push('持仓已超过190天');
  }
  if (rows.some((r) => r.error || r.stale)) issues.push('部分持仓缺行情或沿用旧行情');
  const target = f.navEstimate?.asOf ?? forecast?.date ?? f.date;
  if (
    [forecast?.fx, forecast?.dailyFx, ...rows.flatMap((r) => [r.fx, r.dailyFx])].some(
      (fx) => fx?.target?.date && target && fx.target.date < target,
    )
  )
    issues.push('汇率沿用较早日期');
  if (rows.some((r) => r.marketStatus?.known === false)) issues.push('部分市场日历未覆盖');
  return { attention: issues.length > 0, issues: [...new Set(issues)], holdingDate, coverage };
}
export function reliabilityPanel(f: FundLike): string {
  const r = reliability(f),
    coverage = Number.isFinite(r.coverage) ? (r.coverage as number).toFixed(2) + '%' : '—';
  return `<details class="reliability ${r.attention ? 'needsAttention' : ''}"><summary>${r.attention ? '需要注意 · ' + r.issues.length + ' 项' : '数据检查 · 暂无已识别异常'}</summary><p class="muted">${f.bond ? '债基指数拟合' : f.index || f.indexQuote ? '指数近似模型' : '披露持仓 ' + esc(r.holdingDate ?? '暂无') + ' · 有效资产覆盖 ' + coverage}。数据完整性不代表准确率。</p>${r.issues.length ? '<ul>' + r.issues.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : ''}</details>`;
}

// Exact FX component of the existing model: w * (1 + local return) * FX return.
// The cross term is assigned to FX so price + FX equals the RMB contribution.
export function fundFxImpact(fund: FundLike): FxImpact | null {
  if (fund.navEstimate && !Number.isFinite(fund.navEstimate.return)) return null;
  const forecast = forecastInputs(fund);
  if (!forecast || !Number.isFinite(forecast.model?.return)) return null;
  const from = forecast.base?.date,
    to = forecast.asOf ?? forecast.date;
  if (!from || !to) return null;
  if (forecast.model?.method?.startsWith('index-proxy')) {
    const q = forecast.indexQuote,
      fx = forecast.fx;
    if (!((q?.baseClose ?? 0) > 0) || !Number.isFinite(q?.close) || !Number.isFinite(fx?.return)) return null;
    return {
      from,
      to,
      index: true,
      coverage: 100,
      foreignWeight: 100,
      contribution: ((q?.close as number) / (q?.baseClose as number)) * (fx?.return as number),
    };
  }
  const rows = (forecast.rows ?? []).filter(
    (r) =>
      (r.weight ?? 0) > 0 &&
      Number.isFinite(r.rmbReturn) &&
      Number.isFinite(r.stock?.return) &&
      (r.currency === 'CNY' || (r.currency && Number.isFinite(r.fx?.return))),
  );
  if (!rows.length) return null;
  return {
    from,
    to,
    index: false,
    coverage: rows.reduce((n, r) => n + (r.weight ?? 0), 0),
    foreignWeight: rows.filter((r) => r.currency !== 'CNY').reduce((n, r) => n + (r.weight ?? 0), 0),
    contribution: rows.reduce(
      (n, r) =>
        n +
        (r.currency === 'CNY'
          ? 0
          : ((r.weight ?? 0) / 100) * (1 + (r.stock?.return as number)) * (r.fx?.return as number)),
      0,
    ),
  };
}
