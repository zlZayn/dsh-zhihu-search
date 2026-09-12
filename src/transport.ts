/**
 * 知乎开放平台传输层：鉴权、请求、SSE 解析、错误映射。
 *
 * 分层纪律：本模块**只做传输**，不认识「语义化参数」。
 * `SortBy` / `Filter` 进来时已经是编译好的字符串（见 utils/compiler.ts）。
 * 这样拆的理由：编译规则会随知乎文档变，传输契约不会；混在一起会导致
 * 改一个编译规则要连带重测网络层。
 *
 * 本文件全部结论来自 2026-09-12 对生产接口的实测，不是文档推断：
 * - 成功码是 `0`（不是 200），失败时 `Data` 为 `null`
 * - 失败调用**不消耗每日额度**，故重试无额度成本
 * - `90001` 服务端错误可重试；`10001` 是确定性参数错误，重试无意义
 */

import { TextDecoder } from 'node:util';
import type { ZhihuApiResponse, ZhihuChatError, ZhihuErrorKind, ZhihuSearchData } from './types.js';

/** 接口统一接入域名（实测可用）。 */
export const ZHIHU_BASE_URL = 'https://developer.zhihu.com';

/** 站内搜索端点。只认 `Query`/`Count`/`SortBy`/`Filter(publish_time)`。 */
export const ENDPOINT_ZHIHU_SEARCH = '/api/v1/content/zhihu_search';
/** 全网搜索端点。`Filter` 支持 `host`，但明确拒绝知乎域名。 */
export const ENDPOINT_GLOBAL_SEARCH = '/api/v1/content/global_search';
/** 直答端点（OpenAI 兼容，流式时为 SSE）。 */
export const ENDPOINT_CHAT_COMPLETIONS = '/v1/chat/completions';
/** 额度查询端点；实测**不消耗**业务额度。 */
export const ENDPOINT_QUOTA = '/api/v1/quota';

/** 站内搜索单次 Count 上限（超出服务端自动截断）。 */
export const ZHIHU_SEARCH_MAX_COUNT = 10;
/** 全网搜索单次 Count 上限。 */
export const GLOBAL_SEARCH_MAX_COUNT = 20;

/** SSE 终止哨兵。收到即立刻结束，不再等待连接关闭。 */
const SSE_DONE_SENTINEL = '[DONE]';

/** 服务端错误重试前的退避时长。 */
const RETRY_BACKOFF_MS = 400;

/** 默认单次请求超时。 */
const DEFAULT_TIMEOUT_MS = 15_000;

// ===========================================================================
// 错误
// ===========================================================================

/** 知乎客户端错误的构造参数。 */
export interface ZhihuClientErrorInit {
  /** 平台错误码，网络/解析类错误没有此值。 */
  readonly code?: number;
  /** 面向模型的补救建议；只在「模型能据此换个做法」时才给。 */
  readonly hint?: string;
  /** 原始异常，保留以便排障。 */
  readonly cause?: unknown;
}

/**
 * 知乎客户端统一错误。
 *
 * 为什么要自定义而不是直接 throw Error：
 * 工具层必须把错误映射成 `{ok:false, error:{kind,message,hint}}` 交给模型，
 * `kind` 决定模型「重试有用还是没用」。用裸 Error 会丢失这个区分，
 * 模型只能盲试 —— 那正是我们要防的幻觉来源。
 */
export class ZhihuClientError extends Error {
  readonly kind: ZhihuErrorKind;
  readonly code: number | undefined;
  readonly hint: string | undefined;

  constructor(kind: ZhihuErrorKind, message: string, init: ZhihuClientErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ZhihuClientError';
    this.kind = kind;
    this.code = init.code;
    this.hint = init.hint;
  }
}

/**
 * 平台错误码 → 内部错误种类与面向模型的提示。
 *
 * 实测校准（2026-09-12）：
 * - 20001 的真实诱因常是**本机时钟偏移**，知乎要求时间差 < 10 分钟，
 *   且报错文案不会提示这一点，所以必须由我们补上，否则维护者会去反复检查 Secret。
 * - 30001 是频率限制，额度通常未被扣（失败调用不计费）。
 */
function mapPlatformError(code: number, message: string): ZhihuClientError {
  const text = message.trim() === '' ? `知乎返回错误码 ${code}` : message;
  switch (code) {
    case 10001:
      return new ZhihuClientError('param', text, {
        code,
        hint: '参数不被知乎接受。站内搜索只支持 Filter 的 publish_time，host 仅全网搜索支持且拒绝知乎域名。',
      });
    case 20001:
      return new ZhihuClientError('auth', text, {
        code,
        hint: '若 Secret 正确，请检查本机系统时间。知乎要求时间差 < 10 分钟。',
      });
    case 30001:
      return new ZhihuClientError('rate_limit', text, {
        code,
        hint: '触发频率限制。降低请求频率后重试；失败请求不消耗每日额度。',
      });
    case 90001:
      return new ZhihuClientError('server', text, {
        code,
        hint: '知乎服务端内部错误，已自动重试一次；仍失败请稍后再试。',
      });
    default:
      return new ZhihuClientError('unknown', `${text}（Code=${code}）`, { code });
  }
}

/** 判断异常是否为 AbortSignal 触发的中断。 */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/** 把任意异常归一化为 {@link ZhihuClientError}，保留取消语义。 */
function toClientError(error: unknown, signal: AbortSignal | undefined): ZhihuClientError {
  if (error instanceof ZhihuClientError) return error;
  if (signal?.aborted === true || isAbortError(error)) {
    return new ZhihuClientError('aborted', '请求已被取消。', { cause: error });
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new ZhihuClientError('network', `请求知乎失败：${detail}`, {
    cause: error,
    hint: '网络不可达或 TLS 失败。请确认本机能访问 developer.zhihu.com（可能需要代理）。',
  });
}

// ===========================================================================
// 取消 / 超时
// ===========================================================================

/** 组合「调用方取消」与「本地超时」的信号句柄。 */
interface TimedSignal {
  readonly signal: AbortSignal;
  /** 必须调用：清理定时器与监听器，避免长会话下泄漏。 */
  dispose(): void;
}

/**
 * 把调用方信号与本地超时合成一个信号，并返回显式清理函数。
 *
 * 为什么不用 `AbortSignal.any()` + `AbortSignal.timeout()`：
 * 两者创建的超时定时器无法显式清理，在长驻 Host 进程中会持续持有引用；
 * DSH 对工具生命周期要求「所有资源都在闭包内创建并显式释放」。
 *
 * @param signal - 调用方信号，通常是 `exec.signal`。DSH 要求异步工作必须转发它。
 * @param timeoutMs - 本地超时预算，必须小于工具声明的 `timeoutMs`。
 * @returns 合成信号与清理函数。
 */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): TimedSignal {
  const controller = new AbortController();
  const forward = (): void => {
    controller.abort(signal?.reason);
  };

  if (signal !== undefined) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', forward, { once: true });
  }

  const timer = setTimeout(() => {
    controller.abort(new Error('zhihu request timeout'));
  }, timeoutMs);
  // 不因一个未决定时器阻止进程退出。
  timer.unref();

  return {
    signal: controller.signal,
    dispose(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    },
  };
}

/** 可取消的 sleep。 */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new ZhihuClientError('aborted', '请求已被取消。'));
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    const onAbort = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new ZhihuClientError('aborted', '请求已被取消。'));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ===========================================================================
// SSE 解析
// ===========================================================================

/** 事件块边界的位置与长度。 */
interface EventBoundary {
  index: number;
  length: number;
}

/**
 * 定位下一个 SSE 事件边界（空行）。
 *
 * 同时兼容 `\n\n` 与 `\r\n\r\n`：两者不互相包含
 * （`\r\n\r\n` 中不存在连续两个 \n），所以取更靠前者即可，无需回溯。
 *
 * @param buffer - 尚未消费的文本缓冲。
 * @returns 边界位置，或 `null` 表示事件尚未收完。
 */
function nextEventBoundary(buffer: string): EventBoundary | null {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

/**
 * 从一个事件块中取出 `data` 载荷。
 *
 * 按 SSE 规范：忽略以 `:` 开头的注释行（知乎的心跳是 `: keep-alive`），
 * 忽略 `event:` / `id:` / `retry:` 字段，多条 `data:` 以 \n 连接。
 *
 * @param block - 一个完整事件块的原文（不含分隔空行）。
 * @returns 载荷字符串；无 data 字段时返回 `undefined`。
 */
function extractDataPayload(block: string): string | undefined {
  let sawData = false;
  const parts: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '' || line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    sawData = true;
    let value = line.slice('data:'.length);
    if (value.startsWith(' ')) value = value.slice(1);
    parts.push(value);
  }
  return sawData ? parts.join('\n') : undefined;
}

/**
 * 把字节省流解析为 SSE `data` 载荷序列。
 *
 * ⚠ 本函数存在的唯一理由是**字节截断**：`ReadableStream<Uint8Array>` 的
 * chunk 边界落在多字节 UTF-8 字符中间是常态（中文回复必定触发）。
 * 逐 chunk 调用 `TextDecoder.decode(bytes)`（不带 `stream:true`）会把
 * 半个汉字解成 U+FFFD，JSON.parse 随即崩溃 —— 且偶发，极难复现。
 * 这里靠 `{stream: true}` 让解码器自己持有残片，再配合跨 chunk 的字符串
 * 缓冲，保证事件只有完整时才被切出。
 *
 * 遇到 `data: [DONE]` 立即返回，不等待服务端关闭连接。
 *
 * @param stream - 响应体字节流。
 * @yields 每个 SSE 事件的 data 载荷原文（已剥离前缀，未做 JSON 解析）。
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, undefined> {
  const decoder = new TextDecoder('utf-8');
  const reader = stream.getReader();
  let buffer = '';
  let done = false;

  try {
    while (!done) {
      const chunk = await reader.read();
      if (chunk.value !== undefined) {
        // stream:true —— 让解码器保留跨 chunk 的半个多字节字符。
        buffer += decoder.decode(chunk.value, { stream: true });
      }
      if (chunk.done) {
        // 冲刷解码器内部残片，且此后必须带 stream:false。
        buffer += decoder.decode();
        done = true;
      }

      let boundary = nextEventBoundary(buffer);
      while (boundary !== null) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const payload = extractDataPayload(block);
        if (payload !== undefined) {
          if (payload === SSE_DONE_SENTINEL) return;
          yield payload;
        }
        boundary = nextEventBoundary(buffer);
      }
    }

    // 兼容不补尾空行的服务端：流结束后把残余内容当作最后一个事件。
    const tail = extractDataPayload(buffer);
    if (tail !== undefined && tail !== SSE_DONE_SENTINEL) yield tail;
  } finally {
    // 提前 return（收到 [DONE]）时必须取消，否则底层连接不会释放。
    await reader.cancel().catch(() => undefined);
  }
}

/** 直答流式增量。 */
export interface ZhihuChatChunk {
  /** 正文增量。 */
  readonly content?: string;
  /** 思维链增量。知乎直答会先吐它，再吐正文。 */
  readonly reasoningContent?: string;
}

/**
 * 从一条 SSE 载荷中抽出直答增量。
 *
 * 容错优先：非 JSON、缺 `choices`、`delta` 为空对象都返回 `undefined`，
 * 绝不 throw。理由是流式过程中偶尔会混入非内容事件，
 * 为此中断整轮回答的代价远大于丢掉一个空增量。
 *
 * @param payload - {@link parseSSEStream} 产出的载荷原文。
 * @returns 增量；无可提取内容时返回 `undefined`。
 */
export function deltaFromPayload(payload: string): ZhihuChatChunk | undefined {
  let envelope: unknown;
  try {
    envelope = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof envelope !== 'object' || envelope === null) return undefined;
  const choices = (envelope as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0] as { delta?: unknown } | undefined;
  const delta = first?.delta;
  if (typeof delta !== 'object' || delta === null) return undefined;

  const record = delta as { content?: unknown; reasoning_content?: unknown };
  const chunk: { content?: string; reasoningContent?: string } = {};
  if (typeof record.content === 'string' && record.content !== '') chunk.content = record.content;
  if (typeof record.reasoning_content === 'string' && record.reasoning_content !== '') {
    chunk.reasoningContent = record.reasoning_content;
  }
  return chunk.content === undefined && chunk.reasoningContent === undefined ? undefined : chunk;
}

/** 直答完整结果。 */
export interface ZhihuChatResult {
  readonly content: string;
  readonly reasoningContent: string;
}

// ===========================================================================
// 客户端
// ===========================================================================

/** 构造 {@link ZhihuClient} 的配置。 */
export interface ZhihuClientConfig {
  /**
   * 字面量 Access Secret。
   *
   * 与 {@link ZhihuClientConfig.resolveAccessSecret} 二选一，同时存在时以本字段优先。
   * 主要用于测试与 profile 直填；生产路径应走凭据服务，那是唯一能在设置界面里
   * 被用户修改、且不会把明文写进任何配置文件的通道。
   */
  readonly accessSecret?: string;
  /**
   * 异步解析 Access Secret 的通道，通常桥接 DSH 的 `credentials` 服务。
   *
   * 为什么是回调而不是构造参数：密钥可以在设置界面里被随时改动，
   * 构造期取一次就会让运行中的插件一直用旧值，直到进程重启。
   */
  readonly resolveAccessSecret?: () => Promise<string | undefined>;
  /** 覆盖接入域名，测试用。 */
  readonly baseUrl?: string;
  /** 单次请求超时；应显著小于工具声明的 `timeoutMs`，把重试预算留在外面。 */
  readonly timeoutMs?: number;
  /** 注入 fetch 实现，测试用。 */
  readonly fetchImpl?: typeof fetch;
}

/** 一次搜索请求。`sortBy`/`filter` 已经是编译产物。 */
export interface ZhihuSearchRequest {
  readonly query: string;
  /** 期望条数；超出服务端上限时本地先截断，避免无谓的往返差异。 */
  readonly count?: number;
  /** 编译后的 SortBy，如 `VoteUpCount:desc:(100,)`。省略则不排序。 */
  readonly sortBy?: string;
  /** 编译后的 Filter，如 `publish_time>=1672531200`。省略则不过滤。 */
  readonly filter?: string;
  /** 索引库，仅全网搜索支持。 */
  readonly searchDb?: 'all' | 'realtime' | 'static';
}

/** 直答请求。 */
export interface ZhihuChatRequest {
  /** `zhida-fast-1p5` / `zhida-thinking-1p5` / `zhida-agent`。 */
  readonly model: string;
  /** 对话消息。 */
  readonly messages: ReadonlyArray<{ readonly role: string; readonly content: string }>;
}

/** 类型守卫：校验知乎响应信封。 */
function isEnvelope(value: unknown): value is ZhihuApiResponse<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['Code'] === 'number' && typeof record['Message'] === 'string' && 'Data' in record;
}

/**
 * 知乎开放平台客户端。
 *
 * 无全局状态：实例由 Host 插件的 `ctx.effect()` 创建，随插件卸载一起消失。
 * 这样 HMR 热更新时旧实例自然失效，不会出现两代客户端共用限流桶的情况。
 */
export class ZhihuClient {
  readonly #config: ZhihuClientConfig;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(config: ZhihuClientConfig) {
    // ⚠ 刻意**不在构造期**校验凭据。
    // 这里是 Host 插件的加载路径：构造期抛错会让整个 DSH profile 起不来，
    // 而缺凭据是一个模型可以自己纠正、维护者也能立刻看懂的问题。
    // 因此改在发起请求时抛出结构化错误（见 #headers），让工具把它交回给模型。
    this.#config = config;
    this.#baseUrl = config.baseUrl ?? ZHIHU_BASE_URL;
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = config.fetchImpl ?? fetch;
  }

  /**
   * 取得本次请求要用的 Access Secret。
   *
   * 解析顺序：字面量配置 → 凭据服务。两者都空时抛出可读的鉴权错误，
   * 而不是把一个空 Bearer 发出去换回难以理解的 `20001`。
   *
   * @returns 非空密钥。
   * @throws ZhihuClientError 当两条通道都没有可用值时。
   */
  async #accessSecret(): Promise<string> {
    const literal = this.#config.accessSecret;
    if (literal !== undefined && literal.trim() !== '') return literal;

    const resolve = this.#config.resolveAccessSecret;
    const resolved = resolve === undefined ? undefined : await resolve();
    if (resolved !== undefined && resolved.trim() !== '') return resolved;

    throw new ZhihuClientError('auth', '未配置知乎 Access Secret。', {
      hint: '打开 DSH 设置 → 插件 → 知乎搜索 填入 Access Secret，或在 profile 的 cordis.patch.yml 里设置 config.accessSecret。',
    });
  }

  /**
   * 构造鉴权头。
   *
   * 时间戳**每次请求现取**：知乎要求与服务器时间差 < 10 分钟，
   * 复用实例创建时的时间戳会让长驻会话在 10 分钟后集体 20001。
   */
  async #headers(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.#accessSecret()}`,
      'X-Request-Timestamp': Math.floor(Date.now() / 1000).toString(),
      'Content-Type': 'application/json',
    };
  }

  /** 发起一次请求并拆开信封；只负责单次尝试。 */
  async #once<T>(path: string, init: RequestInit, signal: AbortSignal | undefined): Promise<ZhihuApiResponse<T>> {
    const timed = withTimeout(signal, this.#timeoutMs);
    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: await this.#headers(),
        signal: timed.signal,
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new ZhihuClientError('parse', `知乎返回了非 JSON 响应（HTTP ${response.status}）。`, {
          hint: text.slice(0, 200),
        });
      }
      if (!isEnvelope(parsed)) {
        throw new ZhihuClientError('parse', '知乎响应缺少 Code/Message/Data 字段。', {
          hint: text.slice(0, 200),
        });
      }
      return parsed as ZhihuApiResponse<T>;
    } catch (error) {
      throw toClientError(error, signal);
    } finally {
      timed.dispose();
    }
  }

  /**
   * 请求并解开信封，对可重试错误退避重试一次。
   *
   * 只重试 `server`(90001) 与 `network`：
   * `param`/`auth`/`rate_limit` 都是确定性结果，重试只会浪费一次额度往返。
   * 实测失败调用不扣额度，所以重试的代价只是延迟。
   */
  async #requestJson<T>(path: string, init: RequestInit, signal: AbortSignal | undefined, retries: number): Promise<T> {
    if (signal?.aborted === true) {
      throw new ZhihuClientError('aborted', '请求已被取消。');
    }
    let last: ZhihuClientError | undefined;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const envelope = await this.#once<T>(path, init, signal);
        if (envelope.Code === 0) return envelope.Data;
        last = mapPlatformError(envelope.Code, envelope.Message);
      } catch (error) {
        last = toClientError(error, signal);
      }
      const retryable = last.kind === 'server' || last.kind === 'network';
      if (!retryable || attempt === retries) throw last;
      await sleep(RETRY_BACKOFF_MS * (attempt + 1), signal);
    }
    throw last ?? new ZhihuClientError('unknown', '请求未能完成。');
  }

  /** 组装查询串，并做本地上限截断。 */
  #searchPath(endpoint: string, request: ZhihuSearchRequest, maxCount: number): string {
    const params = new URLSearchParams();
    params.set('Query', request.query);
    const requested = request.count ?? maxCount;
    const count = Math.max(1, Math.min(Math.trunc(requested), maxCount));
    params.set('Count', String(count));
    if (request.sortBy !== undefined && request.sortBy !== '') params.set('SortBy', request.sortBy);
    if (request.filter !== undefined && request.filter !== '') params.set('Filter', request.filter);
    if (request.searchDb !== undefined) params.set('SearchDB', request.searchDb);
    return `${endpoint}?${params.toString()}`;
  }

  /**
   * 知乎站内搜索。
   *
   * ⚠ 该端点的 `Filter` **只接受 `publish_time`**；传 `host` 会得到
   * `10001 invalid Filter expression`（实测）。站点筛选请用 {@link searchGlobal}。
   */
  async searchZhihu(request: ZhihuSearchRequest, signal?: AbortSignal): Promise<ZhihuSearchData> {
    const data = await this.#requestJson<ZhihuSearchData | null>(
      this.#searchPath(ENDPOINT_ZHIHU_SEARCH, request, ZHIHU_SEARCH_MAX_COUNT),
      { method: 'GET' },
      signal,
      1,
    );
    return { HasMore: data?.HasMore ?? false, Items: data?.Items ?? [], SearchHashId: data?.SearchHashId, EmptyReason: data?.EmptyReason };
  }

  /**
   * 知乎全网搜索。
   *
   * `SortBy` 在本端点**疑似被忽略**（实测返回顺序不随排序字段变化），
   * 因此默认不传；`Filter` 的 `host` 可用，但拒绝知乎域名。
   */
  async searchGlobal(request: ZhihuSearchRequest, signal?: AbortSignal): Promise<ZhihuSearchData> {
    const data = await this.#requestJson<ZhihuSearchData | null>(
      this.#searchPath(ENDPOINT_GLOBAL_SEARCH, request, GLOBAL_SEARCH_MAX_COUNT),
      { method: 'GET' },
      signal,
      1,
    );
    return { HasMore: data?.HasMore ?? false, Items: data?.Items ?? [], SearchHashId: data?.SearchHashId, EmptyReason: data?.EmptyReason };
  }

  /** 查询每日额度；实测不消耗业务额度，可用于自检。 */
  async quota(signal?: AbortSignal): Promise<unknown> {
    return this.#requestJson<unknown>(ENDPOINT_QUOTA, { method: 'GET' }, signal, 1);
  }

  /**
   * 发起直答请求，返回原始 SSE 响应体。
   *
   * 与 {@link chat} 分开是为了让调用方能自行处理背压（例如边流边回传 UI），
   * 而不是被迫等整轮回答结束。
   *
   * @throws ZhihuClientError 当响应不是事件流（即错误体或非流式结果）时。
   */
  async openChatStream(request: ZhihuChatRequest, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const timed = withTimeout(signal, this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${ENDPOINT_CHAT_COMPLETIONS}`, {
        method: 'POST',
        headers: await this.#headers(),
        body: JSON.stringify({ ...request, stream: true }),
        signal: timed.signal,
      });
    } catch (error) {
      throw toClientError(error, signal);
    } finally {
      // 注意：此处只释放定时器；流式读取的超时由调用方通过 signal 控制。
      timed.dispose();
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream') || response.body === null) {
      // 直答失败时返回的是 JSON 错误体而非事件流，必须在这里转成结构化错误。
      const text = await response.text();
      throw this.#chatErrorFrom(text, response.status);
    }
    return response.body;
  }

  /** 把直答的非流式响应体解析为错误或非流式结果。 */
  #chatErrorFrom(text: string, status: number): ZhihuClientError {
    try {
      const parsed = JSON.parse(text) as Partial<ZhihuChatError>;
      const failure = parsed.error;
      if (typeof failure === 'object' && failure !== null) {
        const message = typeof failure.message === 'string' ? failure.message : '知乎直答返回错误。';
        const code = typeof failure.code === 'number' ? failure.code : undefined;
        return new ZhihuClientError('unknown', message, { code });
      }
    } catch {
      // 落到下面的通用分支。
    }
    return new ZhihuClientError('parse', `知乎直答未返回事件流（HTTP ${status}）。`, { hint: text.slice(0, 200) });
  }

  /**
   * 执行一次直答并拼接完整回答。
   *
   * 思维链与正文**分开累加**：知乎直答会先输出 `reasoning_content` 再输出
   * `content`，合并会让工具无法区分「思考」与「答案」。
   */
  async chat(request: ZhihuChatRequest, signal?: AbortSignal): Promise<ZhihuChatResult> {
    const stream = await this.openChatStream(request, signal);
    let content = '';
    let reasoningContent = '';
    for await (const payload of parseSSEStream(stream)) {
      const chunk = deltaFromPayload(payload);
      if (chunk === undefined) continue;
      if (chunk.content !== undefined) content += chunk.content;
      if (chunk.reasoningContent !== undefined) reasoningContent += chunk.reasoningContent;
    }
    return { content, reasoningContent };
  }
}
