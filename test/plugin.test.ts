/**
 * 插件装配测试。
 *
 * 覆盖 `apply` 本身 —— 生命周期、设置命名空间、配置默认值、按开关注册、effect 释放。
 * 这里用最小替身 Context，**不修改维护者的真实 DSH profile**。
 */

import { describe, expect, it } from 'vitest';
import { Config as ConfigSchema, ZHIHU_SETTINGS_NAMESPACE, apply, inject, name } from '../src/index.js';
import type { Config } from '../src/index.js';

/** `installSection` 的钩子面；测试用它模拟「设置界面写入」。 */
interface SectionHooks {
  setSource(source: () => Config): void;
  onChange(): void;
}

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

/** 记录注册、设置命名空间与 effect 的最小 Context 替身。 */
function makeContext() {
  const registered: string[] = [];
  const installedSections: Array<{ ns: string; entry: unknown; hooks: SectionHooks }> = [];
  const liveDisposers: Array<() => void> = [];
  const warnings: string[] = [];
  const services = new Map<string, unknown>();
  const listeners = new Map<string, Array<(payload: never) => void>>();
  /** 注册表里真实存在的全局工具名；空集 = 对应的工具插件没装。 */
  const presentTools = new Set<string>();
  /** 每次 `restrict` 调用留下的账，供断言读取。 */
  const restrictions: Array<{ deny: string[]; lifted: boolean }> = [];

  /** 设置文档里本命名空间的 user 层。启动期体检读它、也改写它。 */
  const userSection: Record<string, unknown> = {};
  /** 记账：`mutate` 收到的路径操作。 */
  const mutations: Array<{ ns: string; ops: ReadonlyArray<{ op: string; path: readonly string[] }> }> = [];
  /** 凭据域的替身存储：引用名 → 值。 */
  const credentialStore = new Map<string, string>();

  const ctx: Record<string, unknown> = {
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
    settings: {
      installSection(_owner: unknown, ns: string, _schema: unknown, entry: unknown, hooks: SectionHooks) {
        installedSections.push({ ns, entry, hooks });
      },
      // 与真实 provider 同构：未 redact 的 describe 原样带出 user 层（含 schema 外的键）。
      describe() {
        return [{ ns: ZHIHU_SETTINGS_NAMESPACE, user: { ...userSection } }];
      },
      async mutate(ns: string, ops: ReadonlyArray<{ op: string; path: readonly string[] }>) {
        mutations.push({ ns, ops });
        for (const op of ops) {
          if (op.op === 'unset') delete userSection[op.path[0] ?? ''];
        }
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

  services.set('credentials', {
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
    registered,
    installedSections,
    warnings,
    services,
    presentTools,
    restrictions,
    userSection,
    mutations,
    credentialStore,
    /** 触发 effect 的 disposer，模拟插件卸载。 */
    unload: () => {
      for (const dispose of liveDisposers) dispose();
    },
    /** 投递一个生命周期事件，模拟宿主的 agent 注册表。 */
    emit: (event: string, payload: unknown) => {
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

/** 解析配置：走真实的 schemastery schema，默认值因此也被覆盖到。 */
function resolve(overrides: Partial<Config> = {}): Config {
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

  it('注册设置命名空间，命名空间名与 client 半体的卡片 key 一致', () => {
    const h = makeContext();
    apply(h.ctx as never, resolve());
    expect(h.installedSections).toHaveLength(1);
    expect(h.installedSections[0]?.ns).toBe(ZHIHU_SETTINGS_NAMESPACE);
    expect(ZHIHU_SETTINGS_NAMESPACE).toBe('zhihu-search');
  });

  it('拒绝非法配置值，避免 0 容量缓存这类静默事故', () => {
    const h = makeContext();
    expect(() => apply(h.ctx as never, resolve({ cacheMaxEntries: 0 }))).toThrow(/cacheMaxEntries/);
    expect(() => apply(h.ctx as never, resolve({ searchPerMinute: -1 }))).toThrow(/searchPerMinute/);
    expect(() => apply(h.ctx as never, resolve({ timeoutMs: 1.5 }))).toThrow(/timeoutMs/);
  });

  it('schemastery schema 提供了文档化的默认值', () => {
    const resolved = ConfigSchema({}) as Config;
    expect(resolved.baseUrl).toBe('https://developer.zhihu.com');
    expect(resolved.timeoutMs).toBe(15_000);
    expect(resolved.searchPerMinute).toBe(60);
    expect(resolved.zhidaPerMinute).toBe(10);
    expect(resolved.enableSearch).toBe(true);
    expect(resolved.disableNativeWebSearch).toBe(false);
    expect(resolved.accessSecretRef).toBe('ZHIHU_ACCESS_SECRET');
  });
});

describe('旧明文迁徙（apply 接线）', () => {
  it('把设置里的明文搬进凭据域，并从设置文档删掉', async () => {
    const h = makeContext();
    h.userSection['accessSecret'] = 'LEGACY-PLAINTEXT';
    h.userSection['disableNativeWebSearch'] = true;
    apply(h.ctx as never, resolve());
    await flush();

    expect(h.credentialStore.get('ZHIHU_ACCESS_SECRET')).toBe('LEGACY-PLAINTEXT');
    expect(h.userSection['accessSecret']).toBeUndefined();
    // 同级字段必须活下来 —— 路径寻址删除的全部意义。
    expect(h.userSection['disableNativeWebSearch']).toBe(true);
    expect(h.mutations).toHaveLength(1);
    expect(h.mutations[0]?.ns).toBe(ZHIHU_SETTINGS_NAMESPACE);
  });

  it('凭据域已有值时保留它，只清掉被遮蔽的明文', async () => {
    const h = makeContext();
    h.userSection['accessSecret'] = 'STALE';
    h.credentialStore.set('ZHIHU_ACCESS_SECRET', 'CURRENT');
    apply(h.ctx as never, resolve());
    await flush();

    expect(h.credentialStore.get('ZHIHU_ACCESS_SECRET')).toBe('CURRENT');
    expect(h.userSection['accessSecret']).toBeUndefined();
  });

  it('没有旧明文时什么都不做（绝大多数启动路径）', async () => {
    const h = makeContext();
    apply(h.ctx as never, resolve());
    await flush();
    expect(h.mutations).toEqual([]);
    expect(h.credentialStore.size).toBe(0);
  });

  it('组合配置里的明文搬得走、删不掉，因此如实告警', async () => {
    const h = makeContext();
    apply(h.ctx as never, resolve({ accessSecret: 'FROM-PATCH-YML' }));
    await flush();

    expect(h.credentialStore.get('ZHIHU_ACCESS_SECRET')).toBe('FROM-PATCH-YML');
    // 组合配置不属设置文档，插件没有也不该有改写它的口子。
    expect(h.mutations).toEqual([]);
    expect(h.warnings.join('')).toContain('cordis.patch.yml');
  });

  it('凭据域写不进去时明文原样保留，绝不清空', async () => {
    const h = makeContext();
    h.userSection['accessSecret'] = 'MUST-NOT-BE-LOST';
    h.services.set('credentials', {
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
    apply(h.ctx as never, resolve());
    await flush();

    expect(h.userSection['accessSecret']).toBe('MUST-NOT-BE-LOST');
    expect(h.mutations).toEqual([]);
    expect(h.warnings.join('')).toContain('写入被拒绝');
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

  it('热切换：拨开补装到 live agent，拨回即撤销', () => {
    const h = makeContext();
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x' }));
    const hooks = h.installedSections[0]?.hooks;
    expect(hooks).toBeDefined();
    expect(h.restrictions).toHaveLength(0);

    hooks?.setSource(() => resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    hooks?.onChange();
    expect(h.restrictions.map((record) => record.lifted)).toEqual([false, false]);

    hooks?.setSource(() => resolve({ accessSecret: 'x' }));
    hooks?.onChange();
    expect(h.restrictions.map((record) => record.lifted)).toEqual([true, true]);
  });

  it('保存密钥触发的 onChange 不重复装（幂等）', () => {
    const h = makeContext();
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    h.installedSections[0]?.hooks.onChange();
    h.installedSections[0]?.hooks.onChange();
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
