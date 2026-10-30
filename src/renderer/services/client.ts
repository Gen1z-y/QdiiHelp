/**
 * 请求层：与后端同源 HTTP 通信。
 * 与旧页面 public/request.js 行为一致（超时覆盖响应头与响应体读取），只是补上类型。
 */

interface DeadlineWatch {
  signal: AbortSignal;
  reset(): void;
  clear(): void;
}

/** 每个响应分片都会重置的超时：卡住不动才算超时，长任务不会被误杀。 */
function deadline(timeoutMs: number): DeadlineWatch {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error('请求长时间没有响应，请稍后重试；后台任务可能仍在继续')),
      timeoutMs,
    );
  };
  arm();
  return {
    signal: controller.signal,
    reset: arm,
    clear: () => clearTimeout(timer),
  };
}

export async function requestJson<T>(url: string, options: RequestInit = {}, timeoutMs = 120000): Promise<T> {
  const watch = deadline(timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: watch.signal });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data?.error ?? '请求失败');
    return data;
  } catch (error) {
    if (watch.signal.aborted) throw watch.signal.reason instanceof Error ? watch.signal.reason : new Error('请求超时');
    throw error;
  } finally {
    watch.clear();
  }
}

/** 带 JSON 头的便捷封装。 */
export function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  return requestJson<T>(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> | undefined) },
  });
}

/** 逐行读取 NDJSON（刷新与持仓同步的进度流）。 */
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
      throw new Error(data?.error ?? '请求失败');
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
    if (watch.signal.aborted) throw watch.signal.reason instanceof Error ? watch.signal.reason : new Error('请求超时');
    throw error;
  } finally {
    watch.clear();
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
