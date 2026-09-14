/**
 * 测试夹具。
 *
 * 刻意**不 mock 掉 ZhihuClient**：它是带 `#` 私有字段的类，结构上无法伪造，
 * 而这反而是好事 —— 测试因此走真实的鉴权头拼装、信封拆解与错误映射路径，
 * 只在最外层替换 `fetch`。
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { ZhihuClient } from '../src/transport.js';
import { createState, type StateBundle } from '../src/state.js';
import type { ToolDeps } from '../src/tools/deps.js';

/** 测试用的 fetch 替身。 */
export type FetchHandler = (input: string, init?: RequestInit) => Promise<Response>;

/** 一次测试所需的全部运行期对象。 */
export interface Harness {
  readonly deps: ToolDeps;
  readonly state: StateBundle;
  /** 记录每次请求的完整 URL，用于断言参数编码。 */
  readonly urls: string[];
  /** 记录每次请求的请求头。 */
  readonly headers: Array<Record<string, string>>;
  dispose(): void;
}

/**
 * 构造一套隔离的运行期依赖。
 *
 * @param handler - 处理单次请求的替身。
 * @returns 夹具；务必在测试结束时调用 `dispose()`。
 */
export function makeHarness(handler: FetchHandler): Harness {
  const urls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const state = createState({
    cacheMaxEntries: 50,
    cacheTtlMs: 60_000,
    searchPerMinute: 60,
    zhidaPerMinute: 10,
  });
  const client = new ZhihuClient({
    accessSecret: 'test-secret',
    baseUrl: 'https://example.test',
    fetchImpl: (async (input: string, init?: RequestInit) => {
      urls.push(String(input));
      headers.push((init?.headers ?? {}) as Record<string, string>);
      return handler(String(input), init);
    }) as typeof fetch,
  });

  return {
    deps: {
      client,
      cache: state.cache,
      baseUrl: 'https://example.test',
      credentialId: () => 'test-secret',
      // 与生产同源：工具预算按客户端**实际生效**的流式预算推导。
      streamTimeoutMs: client.streamTimeoutMs,
      searchBucket: state.searchBucket,
      zhidaBucket: state.zhidaBucket,
    },
    state,
    urls,
    headers,
    dispose: () => {
      state.dispose();
    },
  };
}

/** 构造一个 JSON 响应。 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** 构造一个 SSE 响应。 */
export function sseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** 构造一个满足 `execute` 签名的执行上下文（只用到 `signal`）。 */
export function execContext(signal?: AbortSignal): Parameters<ToolDefinition['execute']>[1] {
  const ctx = { signal: signal ?? new AbortController().signal } as unknown;
  return ctx as Parameters<ToolDefinition['execute']>[1];
}

/** 知乎成功信封。 */
export function envelope(data: unknown): unknown {
  return { Code: 0, Message: 'success', Data: data };
}
