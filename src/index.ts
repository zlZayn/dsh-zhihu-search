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
import { credentialRef, isCredentialRefName, type CredentialRef } from '@deepseek-ai/dsh-credentials';
import type {} from '@deepseek-ai/dsh-agent';
import type { SettingsProvider } from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';
import { DEFAULT_STREAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, ZHIHU_BASE_URL, ZhihuClient } from './transport.js';
import { resolveAccessSecret as resolveAccessSecretFrom } from './credentials.js';
import { migrateLegacySecret } from './migrate.js';
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
 * 设置文档、describe 线路与凭据引用名都按它寻址，两端必须用同一个字符串。
 * 它**不再是** client 半体的槽位分派 key：卡片迁到插件页后按包的**包名**分派，
 * 见 [client/index.tsx](client/index.tsx) 的 `BUNDLE_NAME`。
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
   * 旧版的字面量 Access Secret。**已弃用：插件不再把它当作取值来源。**
   *
   * 留在 schema 里有两个不可省的作用，两者都不是「还能填」：
   * 1. `role('secret')` 是 redact 层的锚点。字段一旦移出 schema，redact 就不再认识
   *    它是密钥，明文会**原样出现在发往浏览器的 describe 线路里**（实测，见
   *    [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「密钥解析契约」）。
   * 2. 它是迁徙的入口：启动时由 [migrate.ts](./migrate.ts) 搬进凭据域，再从设置文档里删掉。
   */
  accessSecret?: string;
  /** 凭据引用名（环境变量名或凭据记录名）。 */
  accessSecretRef?: string;
  /** 覆盖接入域名，便于指向沙箱或代理。 */
  baseUrl?: string;
  /** 单次 HTTP 请求的超时预算（毫秒）。搜索走它。 */
  timeoutMs?: number;
  /**
   * 流式生成（直答）整轮读取的超时预算（毫秒）。
   *
   * 与 {@link Config.timeoutMs} 取较大者，因此调大它才有效、调小它不会把生成压回搜索级预算。
   * 直答工具的协作式预算自动跟着它走（见 `tools/zhida.ts`）。
   */
  streamTimeoutMs?: number;
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
  // `secret` 角色只服务 redact 层（见 Config.accessSecret 的说明）；
  // `credential-ref` 角色才是本插件真正的配置面：这一格填的是凭据名，不是凭据本身。
  accessSecret: z.string().role('secret'),
  accessSecretRef: z.string().role('credential-ref').default(DEFAULT_ACCESS_SECRET_REF),
  baseUrl: z.string().default(ZHIHU_BASE_URL),
  timeoutMs: z.natural().default(DEFAULT_TIMEOUT_MS),
  streamTimeoutMs: z.natural().default(DEFAULT_STREAM_TIMEOUT_MS),
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
  resolve(ref: CredentialRef): Promise<{ value: string } | undefined>;
  describe(ref: CredentialRef): Promise<{ configured: boolean; writable: boolean }>;
  set(ref: CredentialRef, value: string): Promise<void>;
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
  assertPositiveInteger('streamTimeoutMs', config.streamTimeoutMs);
  assertPositiveInteger('cacheTtlMs', config.cacheTtlMs);
  assertPositiveInteger('cacheMaxEntries', config.cacheMaxEntries);
  assertPositiveInteger('searchPerMinute', config.searchPerMinute);
  assertPositiveInteger('zhidaPerMinute', config.zhidaPerMinute);

  const baseUrl = config.baseUrl ?? ZHIHU_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const streamTimeoutMs = config.streamTimeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;

  // 权威 section 的读取器。设置界面写入后，Host 通过 setSource 换掉它，
  // 因此在途与后续调用都会看到新值，无需重启。
  let current: () => Config = () => config;

  /**
   * 凭据服务面。由下面的 `ctx.inject(['credentials'])` 就绪后写入，缺席时保持 `undefined`。
   *
   * **不能用 `ctx.get('credentials')` 取它。** 实测（1.6.0 线上）：从本插件的挂载位置
   * `ctx.get` 拿不到该服务，而同一上下文里 `ctx.tools`（走 inject + 属性访问）一直正常 ——
   * 这个对比就是判据。`ctx.get` 按文档是「不受 inject 约束的读取」，绕过的是门禁而不是
   * 服务发现本身，跨挂载位置并不可靠。旧版有一条 `fromSettings` 兜底正好替它兜着，
   * 所以这个洞直到兜底被删掉才暴露。
   *
   * 红线：`ctx.get('credentials')` 由 [test/redlines.test.ts](../test/redlines.test.ts) 静态拦下。
   */
  let credentialFace: CredentialsFace | undefined;

  /**
   * 当下生效的凭据引用名。
   *
   * 默认值的回落只在这一处表达 —— 解析、缓存隔离、迁徙三处都问它，
   * 各自抄一遍必然会漂移。
   */
  const referenceName = (): string => current().accessSecretRef ?? DEFAULT_ACCESS_SECRET_REF;

  /**
   * 把引用名收窄成 seam 认得的 `CredentialRef`；不在语法内时返回 `undefined`。
   *
   * 引用名在卡片上是一个自由文本框，而 seam 的语法是 POSIX shell 标识符
   * （`^[A-Za-z_][A-Za-z0-9_]*$`），越界的名字会让 `credentialRef()` **抛错**。
   * 一个 typo 不该在请求路径上炸开 —— 按 seam 自己的说法，语法之外的名字
   * 「没有可错过的引用」，读作「未配置」才是对的。
   *
   * @param reference - 用户填的引用名。
   * @returns 打上标记的引用，或 `undefined`。
   */
  const brand = (reference: string): CredentialRef | undefined =>
    isCredentialRefName(reference) ? credentialRef(reference) : undefined;

  /**
   * 解析本次调用要用的密钥。
   *
   * 凭据域是唯一的取值口；进程环境只是 provider 缺席时的兜底。
   * 设置里**没有**字面量通道 —— 旧明文由 {@link prepareCredentials} 一次性搬走。
   */
  const resolveAccessSecret = async (): Promise<string | undefined> =>
    resolveAccessSecretFrom({
      referenceName,
      fromCredentials: async (reference) => {
        const ref = brand(reference);
        if (ref === undefined || credentialFace === undefined) return undefined;
        return (await credentialFace.resolve(ref))?.value;
      },
      fromEnvironment: (name) => process.env[name],
    });

  /**
   * 凭据来源标识，仅用于隔离缓存空间。
   *
   * 就是引用名：它不含明文，可以安全参与计算，换一个引用名即换一个缓存空间。
   */
  const credentialId = (): string => `ref:${referenceName()}`;

  /** 一条告警通道；宿主 logger 缺失时静默 —— 诊断本身不该成为故障源。 */
  const logger = (ctx as unknown as { logger?: { warn?: (message: string) => void } }).logger;
  const warn = (message: string): void => {
    logger?.warn?.(message);
  };

  /**
   * 启动期凭据体检：先把旧版明文搬进凭据域，再在真的取不到密钥时告警。
   *
   * 只告警不阻断：profile 必须能正常启动。
   * 与 `agent/created` 同样的纪律 —— 一个可选的诊断不该有否决启动的权力，
   * 所以整条路径的异常都在这里收口。
   *
   * @param settings - 已就绪的设置服务，用于读 user 层与抹掉旧明文。
   */
  const prepareCredentials = async (settings: SettingsProvider): Promise<void> => {
    /**
     * 读设置文档 user 层里的旧明文。
     *
     * 用 `describe()` 而不是 `current()`：后者是 base 与 user 合并后的值，
     * 分不出明文来自哪一层 —— 而「删不删得掉」正好取决于这个区分。
     *
     * @returns user 层里的明文，或 `undefined`。
     */
    const readUserLayer = (): string | undefined => {
      const user: unknown = settings.describe().find((entry) => entry.ns === ZHIHU_SETTINGS_NAMESPACE)?.user;
      if (typeof user !== 'object' || user === null) return undefined;
      const value = (user as Record<string, unknown>)['accessSecret'];
      return typeof value === 'string' ? value : undefined;
    };

    await migrateLegacySecret({
      readLegacy: () => ({
        fromSettings: readUserLayer(),
        fromComposition: config.accessSecret,
      }),
      hasCredential: async () => {
        const ref = brand(referenceName());
        if (ref === undefined || credentialFace === undefined) return false;
        // 问 `configured` 而不是 `resolve`：环境变量也算已配置，
        // 而这正是「要不要再搬一份进去」该看的量。
        return (await credentialFace.describe(ref)).configured;
      },
      adopt: async (value) => {
        const ref = brand(referenceName());
        if (ref === undefined || credentialFace === undefined) {
          // 走到这里说明迁徙被排在凭据服务就绪之后，所以这是真异常而不是时序。
          throw new Error('凭据服务未挂载');
        }
        await credentialFace.set(ref, value);
      },
      purge: async () => {
        await settings.mutate(ZHIHU_SETTINGS_NAMESPACE, [{ op: 'unset', path: ['accessSecret'] }]);
      },
      referenceName,
      warn,
    });

    // 搬完之后仍然取不到，才说明用户是真的还没配。
    if ((await resolveAccessSecret()) === undefined) {
      warn(
        '[zhihu-search] 未找到 Access Secret，工具会注册但调用时返回鉴权错误。可在 DSH 侧边栏 插件（Plugins） → dsh-zhihu-search 详情页中填写，或设置环境变量 ZHIHU_ACCESS_SECRET。',
      );
    }
  };

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
  // 否则插件页的配置卡片取不到值（分派 key 是包名，不是这个命名空间）。
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

    // 凭据是**可选**依赖：拿不到它时卡片仍要能显示、工具仍要能注册（调用时报鉴权错）。
    // 所以嵌套一层 inject 而不是把 'credentials' 写进上面的数组 —— 那会让卡片陪着一起等，
    // 一个没有凭据服务的装配连设置界面都进不去。
    //
    // 嵌套还顺带定死了顺序：迁徙必然发生在 installSection 之后（它要读 user 层、也要改它）。
    settingsCtx.inject(['credentials'], (ready) => {
      credentialFace = ready.credentials as CredentialsFace;

      // 迁徙应尽早完成 —— 老配置里的明文在 redact 眼里仍是 secret 槽位，
      // 但留在盘上就是风险。整条路径幂等，服务重新就绪时重复进入无害。
      void prepareCredentials(settingsCtx.settings).catch((error: unknown) => {
        warn(`[zhihu-search] 启动期凭据体检失败：${error instanceof Error ? error.message : String(error)}`);
      });

      return () => {
        credentialFace = undefined;
      };
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
    const client = new ZhihuClient({ resolveAccessSecret, baseUrl, timeoutMs, streamTimeoutMs });

    const deps: ToolDeps = {
      client,
      cache: state.cache,
      baseUrl,
      credentialId,
      // 工具预算按客户端实际生效的值推导：配置被 max() 抬高时，工具预算跟着抬。
      streamTimeoutMs: client.streamTimeoutMs,
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
export { hasSecretValue, resolveAccessSecret } from './credentials.js';
export type { SecretSources } from './credentials.js';
export { migrateLegacySecret } from './migrate.js';
export type { LegacySecret, MigrationDeps } from './migrate.js';
export { createState, LocalRateLimitError, MemoryCache, TokenBucket } from './state.js';
export { compileFilter, compileSortBy, CompileError } from './utils/compiler.js';
export type { ZhidaOutput, SearchOutput } from './types.js';
