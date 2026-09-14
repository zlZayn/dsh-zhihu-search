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
import type {} from '@deepseek-ai/dsh-agent';
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

/**
 * DSH 原生网页工具名（由 `@deepseek-ai/dsh-tool-web` 注册）。
 *
 * 注意它们并不住在全局层：web profile 关掉了 base bundle 的全局 `tool-web` 行
 * （DSH `bundle/web-app/cordis.patch.yml:470`），改由 **agent preset 的 standing scope**
 * 注册，agent 的 scope 再挂到那一层下面。因此**根上下文的全局视图看不到这两个名字** ——
 * 「它们存在吗」只能站在某个 agent 的 scope 链上问。
 */
const NATIVE_WEB_TOOLS = ['web_search', 'web_fetch'] as const;

/** agent 注册表在本模块用到的最小面（结构类型，不引入新的类型依赖）。 */
interface AgentRegistryFace {
  list(): ReadonlyArray<ScopedAgent>;
}

/** agent 的 scoped 上下文里本模块用到的最小面。 */
interface ScopedAgent {
  readonly id: string;
  readonly ctx: {
    /**
     * 刻意用免 inject 的 `get`，而不是 `ctx.tools` 属性访问。
     *
     * 属性代理要求**该上下文自己**声明过 `tools` 依赖，而 agent scope 的依赖面
     * 由它的铸造者决定、不由本插件决定 —— 实测属性访问会抛
     * `cannot get property "tools" without inject`，而 `get('tools')` 拿到的是
     * 同一个 agent-scope 绑定的注册表，`restrict()` 在其上正常工作。
     */
    get(name: string): unknown;
  };
}

/** agent scope 上的工具注册表，本模块只用这一个方法。 */
interface ScopedToolsFace {
  restrict(filter: { deny: readonly string[] }): () => void;
}

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
  /**
   * 是否对模型隐藏 DSH 原生的 `web_search` / `web_fetch`。
   *
   * 默认 `false`：插件不擅自削宿主能力。打开后按 agent 生效，
   * 且作用于该 agent 派生的子 agent（restriction 沿 scope 链继承）。
   */
  disableNativeWebSearch?: boolean;
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
  disableNativeWebSearch: z.boolean().default(false),
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

  /** 一条告警通道；宿主 logger 缺失时静默 —— 诊断本身不该成为故障源。 */
  const logger = (ctx as unknown as { logger?: { warn?: (message: string) => void } }).logger;
  const warn = (message: string): void => {
    logger?.warn?.(message);
  };

  if ((config.accessSecret ?? '').trim() === '') {
    // 只告警不阻断：profile 必须能正常启动。
    warn(
      '[zhihu-search] 未配置 accessSecret，工具会注册但调用时返回鉴权错误。可在 DSH 设置 → 插件 → 知乎搜索 中填写。',
    );
  }

  // ── 隐藏 DSH 原生网页工具 ──────────────────────────────────────────────
  // restriction 挂在**agent 的 scope** 上，`tools.restrict()` 返回的正是撤销它自己
  // 那一个；想撤销就必须持有它，所以这张表省不掉。restriction 本身随 agent scope
  // 自动撤销，这里只是我们这一侧的账，用于「拨回开关」与「插件卸载」两个时机。
  const restrictions = new Map<string, () => void>();

  /**
   * 取某个 agent scope 上的工具注册表。
   *
   * 用 `ctx.get` 而不是 `ctx.tools`：后者要求 agent scope 自己声明过 `tools` 依赖
   * （见 {@link ScopedAgent}），实测会抛错并被下面的 catch 吞成"静默无效"。
   *
   * @param agent - 目标 agent。
   * @returns 该 scope 的注册表面，或该 scope 没有工具服务时的 undefined。
   */
  const toolsFor = (agent: ScopedAgent): ScopedToolsFace | undefined => {
    const tools = agent.ctx.get('tools') as Partial<ScopedToolsFace> | undefined;
    return typeof tools?.restrict === 'function' ? (tools as ScopedToolsFace) : undefined;
  };

  /**
   * 给一个 agent 装上 restriction（不需要装、或已装时是空操作）。
   *
   * 三步顺序不能换：
   * 1. 开关为假、或这个 agent 已经装过 → 直接返回。这是幂等点：`onChange` 会被**任意**
   *    设置写入触发（保存 Access Secret 同样算）。
   * 2. 逐个名字单独装、单独 catch。原生工具注册在 agent preset 的 standing scope 上，
   *    根上下文的全局视图看不到它们，所以「先问全局视图有没有、再决定装不装」会静默
   *    什么都不做（v1.3.0 的实际故障）。`restrict()` 自己按**该 agent 的 scope 链**校验
   *    名字：存在即装、不存在即抛，逐个试探因此天然就是正确的过滤，且无需新依赖。
   * 3. 一个都没装上 → 不记账，否则会留下一份撤销时无事可做的空账。
   *
   * 被吞掉的只有两种**预期**失败：该 scope 没有工具服务、某个名字不在这条 scope 链上。
   * 异常绝不能漏出去 —— `agent/created` 监听器同步抛错会**否决 agent 创建并回滚**
   * （DSH `core/agent` 的注册表语义），一个可选的界面开关不该有这种权力。
   */
  const installOn = (agent: ScopedAgent): void => {
    if (current().disableNativeWebSearch !== true || restrictions.has(agent.id)) return;
    const tools = toolsFor(agent);
    if (tools === undefined) return;

    const disposers: Array<() => void> = [];
    for (const toolName of NATIVE_WEB_TOOLS) {
      try {
        disposers.push(tools.restrict({ deny: [toolName] }));
      } catch {
        // 这个名字不在该 agent 的 scope 链上（例如没装 tool-web）：不装即可，不是错误。
      }
    }
    if (disposers.length === 0) return;

    restrictions.set(agent.id, () => {
      for (const dispose of disposers) dispose();
    });
  };

  /** 摘掉一个 agent 上的 restriction。 */
  const liftFrom = (agentId: string): void => {
    const dispose = restrictions.get(agentId);
    if (dispose === undefined) return;
    restrictions.delete(agentId);
    try {
      dispose();
    } catch {
      // 撤销失败不该波及别处：账已经销了，scope 销毁时也会兜底清理。
    }
  };

  /**
   * 幂等对账：让每个 live agent 的 restriction 与当前配置一致。
   *
   * 三个时机共用它 —— agent 服务就绪、设置写入、以及新 agent 出现。
   * 幂等是硬要求：保存 Access Secret 同样会触发 `onChange`。
   */
  const syncNativeWebTools = (): void => {
    const registry = ctx.get('agents') as AgentRegistryFace | undefined;
    if (registry === undefined) return;
    const wanted = current().disableNativeWebSearch === true;
    for (const agent of registry.list()) {
      if (wanted) installOn(agent);
      else liftFrom(agent.id);
    }
  };

  // 新 agent 补装；销毁时销账（它的 scope 已随之撤销）。
  ctx.on('agent/created', ({ agent }) => {
    installOn(agent);
  });
  ctx.on('agent/disposed', ({ agent }) => {
    restrictions.delete(agent.id);
  });

  // agent 服务就绪时补一次对账：正常启动顺序下 agent 晚于插件出现，
  // HMR 换装时则可能已经有 live agent。
  ctx.inject(['agents'], () => {
    syncNativeWebTools();
  });

  // 设置命名空间：让 Host 把这个 section 暴露给浏览器端的描述镜像，
  // 否则自带的「插件」设置页不会分派我们的卡片。
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, ZHIHU_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        current = source;
      },
      // 写入后就地生效：可见集在**每次模型请求**时重算，因此下一次请求即采用新集合，
      // 不需要新窗口。DSH 在 section attach/detach 时也会调它，所以这里必须幂等。
      onChange: () => {
        syncNativeWebTools();
      },
    });
  });

  // 插件卸载（含 HMR 换装）：撤掉我们装过的 restriction ——
  // 它们挂在 agent 的 scope 上，不会随本插件卸载自动消失。
  ctx.effect(() => () => {
    for (const dispose of restrictions.values()) {
      try {
        dispose();
      } catch {
        // 同上：卸载路径不因单个撤销失败而中断。
      }
    }
    restrictions.clear();
  }, 'zhihu-search: native web tool restrictions');

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
