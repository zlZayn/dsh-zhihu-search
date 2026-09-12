/**
 * 工具实现的共享依赖包。
 *
 * 为什么要显式打包而不是让每个工具直接闭包捕获 `ctx`：
 * 工具实现因此**不依赖 Cordis**，可以用普通对象构造并直接单测；
 * 生命周期与注册只发生在 `src/index.ts` 一处。
 */

import type { ZhihuClient } from '../transport.js';
import type { MemoryCache, TokenBucket } from '../state.js';
import { buildCacheKey } from '../state.js';

/** 所有知乎工具共用的运行期依赖。 */
export interface ToolDeps {
  /** 已配置凭据解析通道的传输层客户端。 */
  readonly client: ZhihuClient;
  /** 结果缓存。 */
  readonly cache: MemoryCache<unknown>;
  /** 接入域名；参与缓存键计算。 */
  readonly baseUrl: string;
  /**
   * 当前凭据来源的**标识**（不是密钥明文）。
   *
   * 是函数而不是字符串：密钥可以在设置界面里被随时改动，
   * 缓存键必须跟着换，否则换账号后仍会命中上一个账号的结果。
   */
  readonly credentialId: () => string;
  /** 搜索类工具共用的本地令牌桶。 */
  readonly searchBucket: TokenBucket;
  /** 直答专用的本地令牌桶。 */
  readonly zhidaBucket: TokenBucket;
}

/**
 * 计算某次调用的缓存键。
 *
 * @param deps - 运行期依赖。
 * @param toolName - 工具名，隔离缓存空间。
 * @param args - 归一化后的参数。**必须传归一化结果**，否则同义参数会各占一个键。
 * @returns 缓存键。
 */
export function cacheKeyFor(deps: ToolDeps, toolName: string, args: unknown): string {
  return buildCacheKey({
    toolName,
    baseUrl: deps.baseUrl,
    accessSecret: deps.credentialId(),
    args,
  });
}
