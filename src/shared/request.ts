/** 请求超时看门狗：响应头与响应体读取共用一个计时器，每个分片都会重置。 */
interface DeadlineWatch {
  signal: AbortSignal;
  reset(): void;
  clear(): void;
}

/** 刷新任务里的单只基金结果（仅声明界面用到的字段）。 */
export interface RefreshReportItem {
  code: string;
  name?: string;
  status?: string;
  error?: string;
  warning?: string;
  estimated?: boolean;
  published?: boolean;
}

/** 一次刷新任务的记录（对应 lib/refresh-tasks.mjs 返回结构）。 */
export interface RefreshReportRun {
  id: string;
  status: string;
  group?: string | null;
  date?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  counts?: { total?: number; updated?: number; cached?: number; failed?: number; unavailable?: number };
  progress?: { completed?: number; total?: number; code?: string; name?: string; stage?: string };
  items?: RefreshReportItem[];
}

/** 旧页面挂载刷新报告所需的依赖。 */
export interface OperationsOptions {
  api: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  onResults: (run: RefreshReportRun) => Promise<boolean | void> | boolean | void;
}

// Deadlines cover both response headers and response-body consumption.
function deadline(timeoutMs: number): DeadlineWatch {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reset = (): void => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error('请求长时间没有响应，请稍后重试；后台任务可能仍在继续')),
      timeoutMs,
    );
  };
  reset();
  return { signal: controller.signal, reset, clear: () => clearTimeout(timer) };
}

/** 请求 JSON：失败时抛出后端给的 error 文案，超时抛出看门狗的 reason。 */
export async function requestJson<T = unknown>(url: string, options: RequestInit = {}, timeoutMs = 120000): Promise<T> {
  const watch = deadline(timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: watch.signal });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data?.error || '请求失败');
    return data;
  } catch (error) {
    throw watch.signal.aborted ? watch.signal.reason : error;
  } finally {
    watch.clear();
  }
}

/** 逐行读取 NDJSON：每读到一行就回调，读到一半卡住同样由看门狗中断。 */
export async function readLines(
  url: string,
  options: RequestInit,
  onLine: (line: string) => void,
  timeoutMs = 120000,
): Promise<void> {
  const watch = deadline(timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, { ...options, signal: watch.signal });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data?.error || '请求失败');
    }
    if (!response.body) throw new Error('响应无内容');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      watch.reset();
      buffer += decoder.decode(value, { stream: !done });
      let end = buffer.indexOf('\n');
      while (end >= 0) {
        onLine(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf('\n');
      }
      if (done) break;
    }
    if (buffer) onLine(buffer);
  } catch (error) {
    throw watch.signal.aborted ? watch.signal.reason : error;
  } finally {
    watch.clear();
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

const stamp = (s?: string): string =>
  s ? new Date(s).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '暂无';

const states: Record<string, string> = {
  running: '正在刷新',
  complete: '刷新完成',
  partial: '刷新完成，部分失败',
  failed: '刷新失败',
  interrupted: '刷新被后台重启中断',
};

const itemStates: Record<string, string> = { updated: '已更新', cached: '复用有效缓存', failed: '失败' };

/** 刷新报告的 details 内 HTML；没有任务时返回空串。 */
export function refreshReport(run?: RefreshReportRun | null): string {
  if (!run) return '';
  const items = run.items ?? [];
  const c = run.counts ?? {},
    p = run.progress ?? {};
  const failed = items.filter((r) => r.error);
  if (run.status === 'complete' && !failed.length)
    return `<summary>刷新完成 · 共 ${c.total ?? items.length} 只 · ${esc(stamp(run.finishedAt))}</summary><p>已更新 ${c.updated ?? 0} 只，复用有效缓存 ${c.cached ?? 0} 只。</p><p class="muted">${c.unavailable ? '其中 ' + c.unavailable + ' 只暂未具备预估或公布条件。' : ''}历史曲线独立在后台同步，详情可查看各基金数据。</p>`;
  return `<summary>${esc(states[run.status] ?? run.status)} · ${esc(stamp(run.finishedAt ?? run.startedAt))}</summary><p>${run.status === 'running' ? `已完成 ${p.completed ?? 0} / ${p.total ?? '…'} 只 · ${esc(p.name ?? p.code ?? '')} ${esc(p.stage ?? '')}` : `共 ${c.total ?? items.length} 只 · 已更新 ${c.updated ?? 0} · 沿用缓存 ${c.cached ?? 0} · 刷新异常 ${c.failed ?? failed.length} · 暂无预估且未公布 ${c.unavailable ?? 0}`}</p>${run.error ? '<p class="error">' + esc(run.error) + '</p>' : ''}${failed.length ? `<button type="button" data-retry-refresh="${esc(run.id)}">只重试失败的 ${failed.length} 只</button>` : ['failed', 'interrupted'].includes(run.status) ? `<button type="button" data-repeat-refresh="${esc(run.id)}">重新执行本次刷新</button>` : ''}<div class="tablewrap"><table><thead><tr><th>基金</th><th>处理结果</th><th>说明</th></tr></thead><tbody>${items.map((r) => `<tr><td>${esc(r.name)}<small>${esc(r.code)}</small></td><td>${esc(itemStates[r.status ?? ''] ?? r.status ?? '')}</td><td>${esc(r.error ?? r.warning ?? (!r.estimated && !r.published ? '暂无预估，等待数据条件满足' : '已保存'))}</td></tr>`).join('')}</tbody></table></div><p class="muted">历史净值另在后台同步；暂不可估算与请求失败分别记录。刷新不会同步新的披露持仓。</p>`;
}

/** 旧页面：把刷新报告挂到 #notice 后面并轮询。Vue 版由 useRefreshReport 接管。 */
export function mountOperations({ api, onResults }: OperationsOptions): { poll: () => Promise<void> } {
  const report = document.createElement('details');
  report.id = 'refreshReport';
  report.className = 'refreshReport';
  report.hidden = true;
  document.querySelector('#notice')?.after(report);
  let runs: RefreshReportRun[] = [],
    polling = false,
    lastApplied = '';

  async function retry(event: Event): Promise<void> {
    const target = (event.target as Element | null)?.closest<HTMLButtonElement>(
      '[data-retry-refresh],[data-repeat-refresh]',
    );
    if (!target) return;
    target.disabled = true;
    try {
      if (target.dataset.retryRefresh)
        await api('/api/refresh/' + encodeURIComponent(target.dataset.retryRefresh) + '/retry', {
          method: 'POST',
          body: '{}',
        });
      else {
        const run = runs.find((r) => r.id === target.dataset.repeatRefresh);
        await api('/api/refresh', { method: 'POST', body: JSON.stringify({ group: run?.group ?? null }) });
      }
      await poll();
    } catch (failure) {
      const error = document.createElement('p');
      error.className = 'error';
      error.textContent = failure instanceof Error ? failure.message : String(failure);
      target.after(error);
    } finally {
      target.disabled = false;
    }
  }

  report.onclick = retry;

  async function poll(): Promise<void> {
    if (polling || document.hidden) return;
    polling = true;
    try {
      const data = await api<{ runs?: RefreshReportRun[] }>('/api/refresh?brief=1');
      runs = data.runs ?? [];
      const latest = runs[0];
      if (latest) {
        const content = refreshReport(latest);
        if (report.innerHTML !== content) report.innerHTML = content;
        report.hidden = false;
      }
      // Apply all newly completed runs in completion order. A page may have been hidden.
      const finished = runs
        .filter((r) => r.finishedAt && ['complete', 'partial'].includes(r.status))
        .sort((a, b) => (a.finishedAt ?? '').localeCompare(b.finishedAt ?? ''));
      const newest = finished.at(-1),
        token = newest ? newest.id + ':' + newest.finishedAt : '';
      if (newest && lastApplied !== token) {
        const applied = await onResults(newest);
        if (applied !== false) lastApplied = token;
      }
    } catch {
      // 轮询失败不打扰用户，下一轮再试。
    } finally {
      polling = false;
    }
  }

  const interval = setInterval(() => void poll(), 3000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void poll();
  });
  window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
  void poll();
  return { poll };
}
