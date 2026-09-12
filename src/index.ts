/**
 * dsh-zhihu-search 插件入口。
 *
 * 本文件是**唯一**接触 Cordis 的地方：生命周期、配置校验、设置命名空间、工具注册。
 * 工具实现本身不依赖 Cordis，因此可以用普通对象直接单测。
 *
 * 生命周期纪律（红线 4）：
 * 客户端与全部状态（缓存、令牌桶）都在 `ctx.effect()` 内创建，
 * 由返回的 disposer 释放。模块顶层**不持有任何可变状态** ——
 * 否则 HMR 重载后会留下两代插件共用缓存与限流桶的幽灵故障。
 */

import type { Context } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type {} from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';
import { ZHIHU_BASE_URL, ZhihuClient } from './transport.js';
import { resolveAccessSecret as resolveAccessSecretFrom } from './credentials.js';
import { createState } from './state.js';
import type { ToolDeps } from './tools/deps.js';
import { createZhihuGlobalSearchTool } from './tools/global-search.js';
import { createZhihuSearchTool } from './tools/search.js';
import { createZhihuZhidaTool } from './tools/zhida.js';

/** Cordis 插件名，用于 loader 诊断。 */
export const name = 'zhihu-search';

/** 本插件依赖的工具注册表服务。 */
export const inject = ['tools'];

/**
 * 设置命名空间。
 *
 * 同时是 client 半体注册设置卡片时的 `key`：官方「插件」设置页按命名空间
 * 分派卡片，两端必须用同一个字符串，否则卡片不会被渲染。
 */
export const ZHIHU_SETTINGS_NAMESPACE = 'zhihu-search';

/** 凭据引用的默认名，按 DSH 约定取环境变量名。 */
export const DEFAULT_ACCESS_SECRET_REF = 'ZHIHU_ACCESS_SECRET';

/** 插件配置。 */
export interface Config {
  /**
   * 字面量 Access Secret。
   *
   * `role('secret')` 让设置界面把它渲染成掩码输入框，并在下行描述里隐藏其值。
   * 留空时回落到 {@link Config.accessSecretRef} 指向的凭据记录。
   */
  accessSecret?: string;
  /** 凭据引用名（环境变量名或凭据记录名）。 */
  accessSecretRef?: string;
  /** 覆盖接入域名，便于指向沙箱或代理。 */
  baseUrl?: string;
  /** 单次 HTTP 请求的超时预算（毫秒）。 */
  timeoutMs?: number;
  /** 搜索结果缓存存活时长（毫秒）。 */
  cacheTtlMs?: number;
  /** 搜索结果缓存条目上限。 */
  cacheMaxEntries?: number;
  /** 搜索类工具的本地每分钟上限（知乎额度之外的额外保护）。 */
  searchPerMinute?: number;
  /** 直答的本地每分钟上限。 */
  zhidaPerMinute?: number;
  /** 是否注册站内搜索工具。 */
  enableSearch?: boolean;
  /** 是否注册全网搜索工具。 */
  enableGlobalSearch?: boolean;
  /** 是否注册直答工具。 */
  enableZhida?: boolean;
}

/** 配置的运行时校验 schema；默认值同时是文档。 */
export const Config = z.object({
  // 与官方 web 搜索提供者同构：secret 角色负责「掩码显示 + 不下发明文」，
  // credential-ref 角色负责「这一格填的是凭据名而不是凭据本身」。
  accessSecret: z.string().role('secret'),
  accessSecretRef: z.string().role('credential-ref').default(DEFAULT_ACCESS_SECRET_REF),
  baseUrl: z.string().default(ZHIHU_BASE_URL),
  timeoutMs: z.natural().default(15_000),
  cacheTtlMs: z.natural().default(600_000),
  cacheMaxEntries: z.natural().default(200),
  searchPerMinute: z.natural().default(60),
  zhidaPerMinute: z.natural().default(10),
  enableSearch: z.boolean().default(true),
  enableGlobalSearch: z.boolean().default(true),
  enableZhida: z.boolean().default(true),
});

/** 凭据服务在本模块用到的最小面。 */
interface CredentialsFace {
  resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value: string } | undefined>;
}

/**
 * 断言配置项是正整数。
 *
 * 为什么不在 schema 里表达：schemastery 的 `natural()` 接受 0，
 * 而 `cacheMaxEntries: 0` 会静默让缓存永久失效 —— 那是要排查很久的配置事故。
 *
 * @param key - 配置项名，用于错误信息。
 * @param value - 待校验的值。
 * @throws Error 当值不是正整数时。
 */
function assertPositiveInteger(key: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`zhihu-search: 配置项 ${key} 必须是正整数，收到 ${String(value)}`);
  }
}

/**
 * 注册插件：创建状态与客户端，注册设置命名空间，并按配置注册各工具。
 *
 * @param ctx - Cordis 上下文，其 `tools` 注册表接收工具定义。
 * @param config - 已由 {@link Config} 校验并填充默认值的配置。
 */
export function apply(ctx: Context, config: Config): void {
  assertPositiveInteger('timeoutMs', config.timeoutMs);
  assertPositiveInteger('cacheTtlMs', config.cacheTtlMs);
  assertPositiveInteger('cacheMaxEntries', config.cacheMaxEntries);
  assertPositiveInteger('searchPerMinute', config.searchPerMinute);
  assertPositiveInteger('zhidaPerMinute', config.zhidaPerMinute);

  const baseUrl = config.baseUrl ?? ZHIHU_BASE_URL;
  const timeoutMs = config.timeoutMs ?? 15_000;

  // 权威 section 的读取器。设置界面写入后，Host 通过 setSource 换掉它，
  // 因此在途与后续调用都会看到新值，无需重启。
  let current: () => Config = () => config;

  /**
   * 解析本次调用要用的密钥。
   *
   * 顺序：字面量配置 → 凭据服务。凭据服务是设置界面的落点，
   * 也是唯一不会把明文写进任何配置文件的通道。
   */
  const resolveAccessSecret = async (): Promise<string | undefined> =>
    resolveAccessSecretFrom({
      referenceName: () => current().accessSecretRef ?? DEFAULT_ACCESS_SECRET_REF,
      fromCredentials: async (reference) => {
        const credentials = ctx.get('credentials') as CredentialsFace | undefined;
        if (credentials === undefined) return undefined;
        return (await credentials.resolve(credentialRef(reference)))?.value;
      },
      fromSettings: () => current().accessSecret,
      fromEnvironment: (name) => process.env[name],
    });

  /**
   * 凭据来源标识，仅用于隔离缓存空间。
   *
   * 有字面量时用字面量（`buildCacheKey` 内部只取哈希前 8 位），
   * 否则用引用名 —— 引用名不含明文，可以安全地参与计算。
   */
  const credentialId = (): string => {
    const section = current();
    const literal = section.accessSecret;
    if (literal !== undefined && literal.trim() !== '') return literal;
    return `ref:${section.accessSecretRef ?? DEFAULT_ACCESS_SECRET_REF}`;
  };

  if ((config.accessSecret ?? '').trim() === '') {
    // 只告警不阻断：profile 必须能正常启动。
    const logger = (ctx as unknown as { logger?: { warn?: (message: string) => void } }).logger;
    logger?.warn?.(
      '[zhihu-search] 未配置 accessSecret，工具会注册但调用时返回鉴权错误。可在 DSH 设置 → 插件 → 知乎搜索 中填写。',
    );
  }

  // 设置命名空间：让 Host 把这个 section 暴露给浏览器端的描述镜像，
  // 否则自带的「插件」设置页不会分派我们的卡片。
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, ZHIHU_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        current = source;
      },
      onChange: () => {},
    });
  });

  ctx.effect(() => {
    // 全部可变状态在此创建，随 effect 一起销毁。
    const state = createState({
      cacheMaxEntries: config.cacheMaxEntries ?? 200,
      cacheTtlMs: config.cacheTtlMs ?? 600_000,
      searchPerMinute: config.searchPerMinute ?? 60,
      zhidaPerMinute: config.zhidaPerMinute ?? 10,
    });
    const client = new ZhihuClient({ resolveAccessSecret, baseUrl, timeoutMs });

    const deps: ToolDeps = {
      client,
      cache: state.cache,
      baseUrl,
      credentialId,
      searchBucket: state.searchBucket,
      zhidaBucket: state.zhidaBucket,
    };

    const disposers: Array<() => void> = [];
    if (config.enableSearch !== false) disposers.push(ctx.tools.register(createZhihuSearchTool(deps)));
    if (config.enableGlobalSearch !== false) disposers.push(ctx.tools.register(createZhihuGlobalSearchTool(deps)));
    if (config.enableZhida !== false) disposers.push(ctx.tools.register(createZhihuZhidaTool(deps)));

    return () => {
      // 逆序释放：后注册的先撤销，与创建顺序严格对称。
      for (const dispose of disposers.reverse()) dispose();
      state.dispose();
    };
  }, 'zhihu-search: client, state and tools');
}

export { ZHIHU_BASE_URL, ZhihuClient } from './transport.js';
export { resolveAccessSecret } from './credentials.js';
export type { SecretSources } from './credentials.js';
export { createState, LocalRateLimitError, MemoryCache, TokenBucket } from './state.js';
export { compileFilter, compileSortBy, CompileError } from './utils/compiler.js';
export type { ZhidaOutput, SearchOutput } from './types.js';
