/**
 * 插件装配测试。
 *
 * 覆盖 `apply` 本身 —— 生命周期、配置页策略、配置默认值、按开关注册、effect 释放。
 * 这里用最小替身 Context，**不修改维护者的真实 DSH profile**。
 */

import { describe, expect, it } from 'vitest';
import { Config as ConfigSchema, apply, inject, name } from '../src/index.js';
import type { Config } from '../src/index.js';

/**
 * 排空微任务与一轮宏任务。
 *
 * `apply` 里的启动期凭据体检是 fire-and-forget 的（它不许有否决启动的权力），
 * 所以断言它的副作用前要先让它跑完。不涉及真实时钟。
 */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * 把新的 volatile 值提交进**运行中的** config，并投递 Loader 的事件。
 *
 * 这正是 Loader 的提交路径：它把候选解析出来，经 cosmokit 的
 * `Symbol.for('cosmokit.volatile.write')` 协议把值写进**原来那个引用**，再发一次
 * `loader/volatile-update`（见 DSH `vendor/cosmokit/src/volatile.ts` 的 `updateVolatile`）。
 *
 * 用符号而不是 import `updateVolatile`：那是个 `@internal` 导出，而符号是**跨副本**协议 ——
 * 宿主与本包各持一份 cosmokit 时走的正是它。
 *
 * @param target - 运行中 config 上的 volatile 字段。
 * @param source - 新候选里的同名 volatile 字段。
 */
function commitVolatile(target: unknown, source: unknown): void {
  const write = Symbol.for('cosmokit.volatile.write');
  (target as Record<symbol, (value: unknown) => void>)[write]((source as { get(): unknown }).get());
}

/** 记录注册、配置页策略与 effect 的最小 Context 替身。 */
function makeContext() {
  const registered: string[] = [];
  const presentations: Array<{ presentation: { auto?: boolean }; owner: unknown }> = [];
  const liveDisposers: Array<() => void> = [];
  const warnings: string[] = [];
  const services = new Map<string, unknown>();
  const listeners = new Map<string, Array<(payload: never) => void>>();
  /** 注册表里真实存在的全局工具名；空集 = 对应的工具插件没装。 */
  const presentTools = new Set<string>();
  /** 每次 `restrict` 调用留下的账，供断言读取。 */
  const restrictions: Array<{ deny: string[]; lifted: boolean }> = [];
  /** 插件自己的 fiber；`configure` 的 owner 必须是它。 */
  const fiber = { id: 'zhihu-search-fiber' };

  /** 凭据域的替身存储：引用名 → 值。 */
  const credentialStore = new Map<string, string>();

  const ctx: Record<string, unknown> = {
    fiber,
    tools: {
      register(definition: { name: string }) {
        registered.push(definition.name);
        let alive = true;
        return (): void => {
          if (!alive) return;
          alive = false;
          const at = registered.indexOf(definition.name);
          if (at >= 0) registered.splice(at, 1);
        };
      },
      get(name: string) {
        return presentTools.has(name) ? { name } : undefined;
      },
    },
    // 0.1.7 的设置服务面：注册**页面策略**是插件唯一要做的事。
    // 替身刻意只给这一个方法 —— 旧版的 `installSection` / `describe` / `mutate` 三件套
    // 已经不在契约里，多给一个就会把「代码还在调它们」这件事掩盖过去。
    settings: {
      configure(presentation: { auto?: boolean }, owner?: unknown) {
        presentations.push({ presentation, owner });
        return (): void => undefined;
      },
    },
    // cordis 的 inject 只在所需服务齐备时回调；替身对齐这一点，
    // 否则「agent 服务不在场」这条路径永远测不到。
    inject(names: readonly string[], callback: (derived: unknown) => void) {
      const available = names.every(
        (service) => ctx[service] !== undefined || services.has(service),
      );
      if (available) callback(ctx);
    },
    on(event: string, callback: (payload: never) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), callback]);
      return (): void => {};
    },
    get(key: string) {
      return services.get(key);
    },
    effect(execute: () => unknown) {
      const result = execute();
      if (typeof result === 'function') liveDisposers.push(result as () => void);
      return { dispose: async () => undefined };
    },
    logger: { warn: (message: string) => warnings.push(message) },
  };

  /**
   * 提供服务的替身。
   *
   * 两处都要写，对齐 cordis 的真实注入面：`get` 查的是服务表，而**属性访问**是注入后
   * `ctx.<name>` 的形态 —— 本插件取凭据只走后者（`ctx.get('credentials')` 在真实装配里
   * 拿不到服务，见 [复盘](../../docs/postmortem/2026-09-15-credential-service-unreachable.md)），
   * 替身若只填服务表，这条路径就永远测不到。
   *
   * @param name - 服务名。
   * @param value - 服务面。
   */
  const provide = (name: string, value: unknown): void => {
    services.set(name, value);
    ctx[name] = value;
  };

  provide('credentials', {
    async resolve(ref: string) {
      const value = credentialStore.get(ref);
      return value === undefined ? undefined : { value };
    },
    async describe(ref: string) {
      return { configured: credentialStore.has(ref), writable: !credentialStore.has(ref) };
    },
    async set(ref: string, value: string) {
      credentialStore.set(ref, value);
    },
  });

  return {
    ctx,
    fiber,
    registered,
    presentations,
    warnings,
    services,
    provide,
    presentTools,
    restrictions,
    credentialStore,
    /** 触发 effect 的 disposer，模拟插件卸载。 */
    unload: () => {
      for (const dispose of liveDisposers) dispose();
    },
    /** 投递一个生命周期事件，模拟宿主的 agent 注册表 / Loader。 */
    emit: (event: string, payload?: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(payload as never);
    },
  };
}

/**
 * agent 的最小替身。
 *
 * 两处刻意对齐真实实现，否则测不出关键路径：
 * - 只提供免 inject 的 `get('tools')`（真实环境里属性访问 `ctx.tools` 会抛 without inject）；
 * - `restrict()` 对**不在该 scope 链上的名字**抛错，就像真实注册表那样 —— 替身若默默接受
 *   任何名字，"名字过滤"这一步就永远测不到。
 *
 * @param knownTools - 该 agent 的 scope 链上真实存在的原生工具名。
 * @param hasToolsService - 该 scope 是否拿得到工具服务。
 */
function fakeAgent(
  id: string,
  restrictions: Array<{ deny: string[]; lifted: boolean }>,
  knownTools: readonly string[] = ['web_search', 'web_fetch'],
  hasToolsService = true,
) {
  return {
    id,
    ctx: {
      get(name: string): unknown {
        if (name !== 'tools' || !hasToolsService) return undefined;
        return {
          restrict(filter: { deny: readonly string[] }) {
            const unknown = filter.deny.filter((toolName) => !knownTools.includes(toolName));
            if (unknown.length > 0) {
              throw new Error(`tools.restrict() names unknown global tool(s) ${unknown.join(', ')}`);
            }
            const record = { deny: [...filter.deny], lifted: false };
            restrictions.push(record);
            return (): void => {
              record.lifted = true;
            };
          },
        };
      },
    },
  };
}

/** agent 注册表的最小替身。 */
function fakeAgents(agents: Array<ReturnType<typeof fakeAgent>>) {
  return { list: () => agents };
}

/**
 * 配置的**输入**形状。
 *
 * volatile 字段在 schema 的入口收普通值，出口才是活引用 —— 所以「传进去的」与
 * 「`apply` 收到的」是两个不同的类型，别拿 `Partial<Config>` 当输入用。
 */
type RawConfig = Omit<Partial<Config>, 'accessSecretRef' | 'disableNativeWebSearch'> & {
  accessSecretRef?: string;
  disableNativeWebSearch?: boolean;
};

/** 解析配置：走真实的 schemastery schema，默认值因此也被覆盖到。 */
function resolve(overrides: RawConfig = {}): Config {
  return ConfigSchema({ ...overrides }) as Config;
}

describe('插件元数据', () => {
  it('声明插件名与所需服务', () => {
    expect(name).toBe('zhihu-search');
    expect(inject).toEqual(['tools']);
  });
});

describe('apply', () => {
  it('默认注册全部三个工具', () => {
    const h = makeContext();
    apply(h.ctx as never, resolve());
    expect(h.registered).toEqual(['zhihu_search', 'zhihu_global_search', 'zhihu_zhida']);
  });

  it('按开关裁剪注册集合', () => {
    const h = makeContext();
    apply(h.ctx as never, resolve({ enableGlobalSearch: false, enableZhida: false }));
    expect(h.registered).toEqual(['zhihu_search']);
  });

  it('卸载时释放全部注册与状态', () => {
    const h = makeContext();
    apply(h.ctx as never, resolve());
    expect(h.registered).toHaveLength(3);
    h.unload();
    expect(h.registered).toEqual([]);
  });

  it('缺凭据时只告警，不阻断 profile 启动', async () => {
    const h = makeContext();
    apply(h.ctx as never, resolve());
    expect(h.registered).toHaveLength(3);
    await flush();
    expect(h.warnings.join('')).toContain('Access Secret');
  });

  it('注册配置页策略：configure({ auto: false }) 且 owner 是本插件自己的 fiber', () => {
    // 0.1.7 起插件不再「注册设置命名空间」，只声明「这一行自带页面」。
    // owner 传错（例如传 inject 子级）会让策略挂到别的 fiber 上：换装时摘不掉，
    // 重入时抛 'already configured'。
    const h = makeContext();
    apply(h.ctx as never, resolve());

    expect(h.presentations).toHaveLength(1);
    expect(h.presentations[0]?.presentation).toEqual({ auto: false });
    expect(h.presentations[0]?.owner).toBe(h.fiber);
  });

  it('拒绝非法配置值，避免 0 容量缓存这类静默事故', () => {
    const h = makeContext();
    expect(() => apply(h.ctx as never, resolve({ cacheMaxEntries: 0 }))).toThrow(/cacheMaxEntries/);
    expect(() => apply(h.ctx as never, resolve({ searchPerMinute: -1 }))).toThrow(/searchPerMinute/);
    expect(() => apply(h.ctx as never, resolve({ timeoutMs: 1.5 }))).toThrow(/timeoutMs/);
  });

  it('schemastery schema 提供了文档化的默认值，且两个活引用可读', () => {
    const resolved = ConfigSchema({}) as Config;
    expect(resolved.baseUrl).toBe('https://developer.zhihu.com');
    expect(resolved.timeoutMs).toBe(15_000);
    expect(resolved.searchPerMinute).toBe(60);
    expect(resolved.zhidaPerMinute).toBe(10);
    expect(resolved.enableSearch).toBe(true);
    // volatile 字段的读法只有一个：`.get()`。带默认值的字段还必须是 `Volatile<T>` 而不是
    // `Volatile<T | undefined>` —— 那取决于 schema 里 `.default()` 与 `.volatile()` 的先后。
    expect(resolved.disableNativeWebSearch?.get()).toBe(false);
    expect(resolved.accessSecretRef?.get()).toBe('ZHIHU_ACCESS_SECRET');
  });
});

describe('组合配置明文迁徙（apply 接线）', () => {
  // 0.1.7 起只剩这一条来源：旧 settings.yaml 那半边随宿主一起没了（宿主的
  // importLegacyDocument 按 section 名当 entry id 导入，只映射三个官方 section）。
  // 因此这一组里没有一处断言「设置文档被改写」—— 那个动作已经不存在了。
  it('没有旧明文时什么都不做（绝大多数启动路径）', async () => {
    const h = makeContext();
    apply(h.ctx as never, resolve());
    await flush();
    expect(h.credentialStore.size).toBe(0);
    expect(h.warnings.join('')).toContain('Access Secret');
  });

  it('组合配置里的明文搬得走、删不掉，因此如实告警', async () => {
    const h = makeContext();
    apply(h.ctx as never, resolve({ accessSecret: 'FROM-PATCH-YML' }));
    await flush();

    expect(h.credentialStore.get('ZHIHU_ACCESS_SECRET')).toBe('FROM-PATCH-YML');
    // 组合配置不属设置文档，插件没有也不该有改写它的口子 —— 只能说给人听。
    expect(h.warnings.join('')).toContain('cordis.patch.yml');
    expect(h.warnings.join('')).toContain('手动移除');
  });

  it('凭据域已有值时保留它，只把组合配置那份明文说成残留', async () => {
    const h = makeContext();
    h.credentialStore.set('ZHIHU_ACCESS_SECRET', 'CURRENT');
    apply(h.ctx as never, resolve({ accessSecret: 'STALE' }));
    await flush();

    expect(h.credentialStore.get('ZHIHU_ACCESS_SECRET')).toBe('CURRENT');
    expect(h.warnings.join('')).toContain('保留');
    expect(h.warnings.join('')).toContain('残留');
  });

  it('凭据域写不进去时明文原样保留，绝不清空', async () => {
    const h = makeContext();
    h.provide('credentials', {
      async resolve() {
        return undefined;
      },
      async describe() {
        return { configured: false, writable: true };
      },
      async set() {
        throw new Error('写入被拒绝');
      },
    });
    apply(h.ctx as never, resolve({ accessSecret: 'MUST-NOT-BE-LOST' }));
    await flush();

    expect(h.credentialStore.size).toBe(0);
    expect(h.warnings.join('')).toContain('写入被拒绝');
    expect(h.warnings.join('')).toContain('原样保留');
  });
});

describe('隐藏原生网页工具', () => {
  it('原生工具不在场时不装任何 restriction，也不让 agent 创建失败', () => {
    const h = makeContext();
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions, [])]));
    expect(() => {
      apply(h.ctx as never, resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    }).not.toThrow();
    expect(h.restrictions).toHaveLength(0);
    // 新 agent 出现：监听器同样必须静默 —— 同步抛错会否决 agent 创建并回滚。
    expect(() => {
      h.emit('agent/created', { agent: fakeAgent('fresh', h.restrictions, []) });
    }).not.toThrow();
    expect(h.restrictions).toHaveLength(0);
  });

  it('两个原生工具都在场时，每个名字各装一条（取交集等价）', () => {
    const h = makeContext();
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    expect(h.restrictions.map((record) => record.deny)).toEqual([['web_search'], ['web_fetch']]);

    h.emit('agent/created', { agent: fakeAgent('fresh', h.restrictions) });
    expect(h.restrictions).toHaveLength(4);
  });

  it('只存在其中一个原生工具时，只装存在的那一个', () => {
    const h = makeContext();
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions, ['web_search'])]));
    apply(h.ctx as never, resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    expect(h.restrictions.map((record) => record.deny)).toEqual([['web_search']]);
  });

  it('开关关闭时对账是空操作', () => {
    const h = makeContext();
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x' }));
    expect(h.restrictions).toHaveLength(0);
  });

  it('该 scope 拿不到工具服务时静默跳过，不抛错', () => {
    const h = makeContext();
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions, [], false)]));
    expect(() => {
      apply(h.ctx as never, resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    }).not.toThrow();
    expect(h.restrictions).toHaveLength(0);
  });

  it('热切换：loader/volatile-update 后拨开补装到 live agent，再拨回即撤销', () => {
    const h = makeContext();
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    const config = resolve({ accessSecret: 'x' });
    apply(h.ctx as never, config);
    expect(h.restrictions).toHaveLength(0);

    // 拨开：Loader 把新值提交进**原来那个引用**，再发一次实例局部的事件。
    commitVolatile(
      config.disableNativeWebSearch,
      resolve({ accessSecret: 'x', disableNativeWebSearch: true }).disableNativeWebSearch,
    );
    h.emit('loader/volatile-update');
    expect(h.restrictions.map((record) => record.lifted)).toEqual([false, false]);

    commitVolatile(
      config.disableNativeWebSearch,
      resolve({ accessSecret: 'x' }).disableNativeWebSearch,
    );
    h.emit('loader/volatile-update');
    expect(h.restrictions.map((record) => record.lifted)).toEqual([true, true]);
  });

  it('保存密钥同样是一次 volatile 写入，重复对账不重复装（幂等）', () => {
    // 幂等是硬要求：引用名也是 volatile，用户每保存一次密钥就会走一遍这条对账。
    const h = makeContext();
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    const config = resolve({ accessSecret: 'x', disableNativeWebSearch: true });
    apply(h.ctx as never, config);

    commitVolatile(
      config.accessSecretRef,
      resolve({ accessSecret: 'x', disableNativeWebSearch: true, accessSecretRef: 'OTHER_REF' }).accessSecretRef,
    );
    h.emit('loader/volatile-update');
    h.emit('loader/volatile-update');
    expect(h.restrictions).toHaveLength(2);
  });

  it('agent 销毁后销账：不再去调用一个已随 scope 撤销的 restriction', () => {
    const h = makeContext();
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    h.emit('agent/disposed', { agent: { id: 'live' } });
    h.unload();
    // agent 的 scope 已经撤销了 restriction，这里再调那些 disposer 只会是多余动作。
    expect(h.restrictions.map((record) => record.lifted)).toEqual([false, false]);
  });

  it('卸载时撤销仍挂在 live agent 上的 restriction', () => {
    const h = makeContext();
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    expect(h.restrictions).toHaveLength(2);
    h.unload();
    expect(h.restrictions.map((record) => record.lifted)).toEqual([true, true]);
  });
});
