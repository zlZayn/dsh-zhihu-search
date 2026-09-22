/**
 * 插件内部状态：结果缓存与本地令牌桶。
 *
 * 红线：**不得使用模块级全局变量**。
 * 所有实例都由插件 `ctx.effect()` 创建，并通过返回的 disposer 释放。
 * 理由是 DSH 有 HMR 热更新：若状态住在模块顶层，重载后会出现「两代插件
 * 共用同一个限流桶 / 缓存」的幽灵故障，且旧凭据的数据不会被清掉。
 */

import { createHash } from 'node:crypto';

/** 本地令牌桶拒绝请求时抛出。它**不消耗**知乎额度，因为没有发出请求。 */
export class LocalRateLimitError extends Error {
  /** 建议等待多久再试（毫秒）。 */
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'LocalRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** {@link TokenBucket} 的构造参数。 */
export interface TokenBucketOptions {
  /** 桶容量，即允许的瞬时突发量。 */
  readonly capacity: number;
  /** 每分钟补充的令牌数。 */
  readonly refillPerMinute: number;
  /** 时间源，测试用。默认 {@link Date.now}。 */
  readonly now?: () => number;
}

/**
 * 惰性补充的令牌桶。
 *
 * 为什么「惰性」而不是起一个定时器补令牌：
 * 定时器在长驻 Host 进程里是常驻资源，且 HMR 时会变成野指针。
 * 惰性实现零定时器 —— 令牌数按「距上次取用的时间差」现算，
 * 因此 {@link dispose} 只需要标记失效，没有任何东西要清理。
 */
export class TokenBucket {
  readonly #capacity: number;
  readonly #refillPerMs: number;
  readonly #now: () => number;
  #tokens: number;
  #lastRefillAt: number;
  #disposed = false;

  constructor(options: TokenBucketOptions) {
    this.#capacity = options.capacity;
    this.#refillPerMs = options.refillPerMinute / 60_000;
    this.#now = options.now ?? Date.now;
    this.#tokens = options.capacity;
    this.#lastRefillAt = this.#now();
  }

  /** 当前可用令牌数（已计入补充）。 */
  get available(): number {
    this.#refill();
    return this.#tokens;
  }

  /**
   * 尝试取走一个令牌（不等待）。
   *
   * 刻意不阻塞：DSH 工具的 `timeoutMs` 是协作式预算，
   * 在里面排队等待会让「限流」变成「超时」，错误分类随之失真。
   *
   * @returns 是否取得令牌。
   */
  tryConsume(): boolean {
    if (this.#disposed) return true;
    this.#refill();
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }

  /** 距离攒够一个令牌还需多久（毫秒）；已有令牌时为 0。 */
  retryAfterMs(): number {
    this.#refill();
    if (this.#tokens >= 1) return 0;
    return Math.ceil((1 - this.#tokens) / this.#refillPerMs);
  }

  /** 标记失效。之后的调用一律放行，避免卸载过程中误伤在途请求。 */
  dispose(): void {
    this.#disposed = true;
  }

  #refill(): void {
    const now = this.#now();
    const elapsed = now - this.#lastRefillAt;
    if (elapsed <= 0) return;
    this.#tokens = Math.min(this.#capacity, this.#tokens + elapsed * this.#refillPerMs);
    this.#lastRefillAt = now;
  }
}

/** {@link MemoryCache} 的构造参数。 */
export interface MemoryCacheOptions {
  /** 条目上限；超出后按 LRU 淘汰。 */
  readonly maxEntries: number;
  /** 默认存活时长（毫秒）。 */
  readonly defaultTtlMs: number;
  /** 时间源，测试用。 */
  readonly now?: () => number;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

/**
 * 带 TTL 与 LRU 淘汰的内存缓存。
 *
 * 为什么缓存是必需的：知乎的每日额度是按自然日结算的硬上限，
 * 一次重复查询会真实吃掉一次额度。同样的查询在 TTL 内必须只发一次。
 *
 * LRU 用 Map 的插入顺序实现：`get` 命中后重新插入，
 * 于是 Map 头部永远是最久未用的条目。
 */
export class MemoryCache<V> {
  readonly #entries = new Map<string, CacheEntry<V>>();
  readonly #maxEntries: number;
  readonly #defaultTtlMs: number;
  readonly #now: () => number;
  #disposed = false;

  constructor(options: MemoryCacheOptions) {
    this.#maxEntries = options.maxEntries;
    this.#defaultTtlMs = options.defaultTtlMs;
    this.#now = options.now ?? Date.now;
  }

  /** 当前未过期条目数（顺带清理过期项）。 */
  get size(): number {
    this.#evictExpired();
    return this.#entries.size;
  }

  /** 读取缓存；过期视为未命中。 */
  get(key: string): V | undefined {
    if (this.#disposed) return undefined;
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    // 命中后移到 Map 尾部 = 标记为最近使用。
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  /** 写入缓存，并在超出容量时淘汰最久未用条目。 */
  set(key: string, value: V, ttlMs: number = this.#defaultTtlMs): void {
    if (this.#disposed) return;
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt: this.#now() + ttlMs });
    this.#evictExpired();
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  /** 清空全部条目。 */
  clear(): void {
    this.#entries.clear();
  }

  /** 释放：清空内容并停止接受读写。 */
  dispose(): void {
    this.#disposed = true;
    this.#entries.clear();
  }

  #evictExpired(): void {
    const now = this.#now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
  }
}

/** 计算缓存键所需的上下文。 */
export interface CacheKeyParts {
  /** 工具名，隔离不同工具的缓存空间。 */
  readonly toolName: string;
  /** 接入域名。 */
  readonly baseUrl: string;
  /** Access Secret；**只取其哈希前 8 位**，绝不把明文写进键。 */
  readonly accessSecret: string;
  /** 归一化后的参数。 */
  readonly args: unknown;
}

/** 是不是普通对象（`null` 与数组都不算）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 稳定的 JSON 序列化：递归按键名排序，保证同样的参数恒得同样的键。 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value) ?? 'null';
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/** 计算 SHA-256 十六进制摘要。 */
function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * 生成缓存键。
 *
 * 格式沿用设计：`sha256(toolName|baseUrl|sha256(secret).slice(0,8)|stableJson(args))`。
 * 掺入凭据哈希的理由：换一把 Secret 就是换一个账号，
 * 绝不能命中上一个账号的缓存结果。
 *
 * @param parts - 键上下文。
 * @returns 十六进制缓存键。
 */
export function buildCacheKey(parts: CacheKeyParts): string {
  const secretFingerprint = sha256(parts.accessSecret).slice(0, 8);
  return sha256(`${parts.toolName}|${parts.baseUrl}|${secretFingerprint}|${stableStringify(parts.args)}`);
}

/** {@link createState} 的配置。 */
export interface StateConfig {
  /** 缓存条目上限。 */
  readonly cacheMaxEntries: number;
  /** 缓存默认存活时长（毫秒）。 */
  readonly cacheTtlMs: number;
  /** 搜索类工具的每分钟上限。 */
  readonly searchPerMinute: number;
  /** 直答的每分钟上限。 */
  readonly zhidaPerMinute: number;
  /** 时间源，测试用。 */
  readonly now?: () => number;
}

/** 一次性创建并统一释放的插件内部状态。 */
export interface StateBundle {
  readonly cache: MemoryCache<unknown>;
  readonly searchBucket: TokenBucket;
  readonly zhidaBucket: TokenBucket;
  /** 释放全部状态。由 `ctx.effect()` 的 disposer 调用。 */
  dispose(): void;
}

/**
 * 创建插件运行的完整状态集合。
 *
 * 调用方必须是 `ctx.effect(() => { const state = createState(cfg); return () => state.dispose(); })`，
 * 而不是模块级单例。
 *
 * @param config - 容量与速率配置。
 * @returns 状态集合。
 */
export function createState(config: StateConfig): StateBundle {
  const cache = new MemoryCache<unknown>({
    maxEntries: config.cacheMaxEntries,
    defaultTtlMs: config.cacheTtlMs,
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  const searchBucket = new TokenBucket({
    capacity: config.searchPerMinute,
    refillPerMinute: config.searchPerMinute,
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  const zhidaBucket = new TokenBucket({
    capacity: config.zhidaPerMinute,
    refillPerMinute: config.zhidaPerMinute,
    ...(config.now === undefined ? {} : { now: config.now }),
  });

  return {
    cache,
    searchBucket,
    zhidaBucket,
    dispose(): void {
      cache.dispose();
      searchBucket.dispose();
      zhidaBucket.dispose();
    },
  };
}
