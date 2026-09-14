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

  return {
    ctx,
    registered,
    installedSections,
    warnings,
    services,
    presentTools,
    restrictions,
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

/** agent 的最小替身：只带 `id` 与 scoped ctx 上的 `restrict`。 */
function fakeAgent(id: string, restrictions: Array<{ deny: string[]; lifted: boolean }>) {
  return {
    id,
    ctx: {
      tools: {
        restrict(filter: { deny: readonly string[] }) {
          const record = { deny: [...filter.deny], lifted: false };
          restrictions.push(record);
          return (): void => {
            record.lifted = true;
          };
        },
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
    apply(h.ctx as never, resolve({ accessSecret: 'secret' }));
    expect(h.registered).toEqual(['zhihu_search', 'zhihu_global_search', 'zhihu_zhida']);
  });

  it('按开关裁剪注册集合', () => {
    const h = makeContext();
    apply(h.ctx as never, resolve({ accessSecret: 'secret', enableGlobalSearch: false, enableZhida: false }));
    expect(h.registered).toEqual(['zhihu_search']);
  });

  it('卸载时释放全部注册与状态', () => {
    const h = makeContext();
    apply(h.ctx as never, resolve({ accessSecret: 'secret' }));
    expect(h.registered).toHaveLength(3);
    h.unload();
    expect(h.registered).toEqual([]);
  });

  it('缺凭据时只告警，不阻断 profile 启动', () => {
    const h = makeContext();
    apply(h.ctx as never, resolve({ accessSecret: '' }));
    expect(h.registered).toHaveLength(3);
    expect(h.warnings.join('')).toContain('accessSecret');
  });

  it('注册设置命名空间，命名空间名与 client 半体的卡片 key 一致', () => {
    const h = makeContext();
    apply(h.ctx as never, resolve({ accessSecret: 'secret' }));
    expect(h.installedSections).toHaveLength(1);
    expect(h.installedSections[0]?.ns).toBe(ZHIHU_SETTINGS_NAMESPACE);
    expect(ZHIHU_SETTINGS_NAMESPACE).toBe('zhihu-search');
  });

  it('拒绝非法配置值，避免 0 容量缓存这类静默事故', () => {
    const h = makeContext();
    expect(() => apply(h.ctx as never, resolve({ accessSecret: 'x', cacheMaxEntries: 0 }))).toThrow(/cacheMaxEntries/);
    expect(() => apply(h.ctx as never, resolve({ accessSecret: 'x', searchPerMinute: -1 }))).toThrow(/searchPerMinute/);
    expect(() => apply(h.ctx as never, resolve({ accessSecret: 'x', timeoutMs: 1.5 }))).toThrow(/timeoutMs/);
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

  it('密钥字段带 secret 角色，凭据名带 credential-ref 角色（设置界面靠它渲染）', () => {
    const dict = (ConfigSchema as unknown as { dict: Record<string, { meta?: { role?: string } }> }).dict;
    const secret = dict['accessSecret'];
    const ref = dict['accessSecretRef'];
    expect(secret?.meta?.role).toBe('secret');
    expect(ref?.meta?.role).toBe('credential-ref');
  });
});

describe('隐藏原生网页工具', () => {
  it('tool-web 未启用时不装 restriction，也不让 agent 创建失败', () => {
    const h = makeContext();
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    expect(h.restrictions).toHaveLength(0);
    // 新 agent 出现：监听器必须静默 —— 同步抛错会否决 agent 创建并回滚。
    expect(() => {
      h.emit('agent/created', { agent: fakeAgent('fresh', h.restrictions) });
    }).not.toThrow();
    expect(h.restrictions).toHaveLength(0);
    expect(h.warnings.join('')).not.toContain('隐藏原生网页工具');
  });

  it('tool-web 在场时，live agent 与后来的 agent 都被装上', () => {
    const h = makeContext();
    h.presentTools.add('web_search');
    h.presentTools.add('web_fetch');
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    expect(h.restrictions.map((record) => record.deny)).toEqual([['web_search', 'web_fetch']]);

    h.emit('agent/created', { agent: fakeAgent('fresh', h.restrictions) });
    expect(h.restrictions).toHaveLength(2);
  });

  it('只存在其中一个原生工具时，只 deny 存在的那一个', () => {
    const h = makeContext();
    h.presentTools.add('web_search');
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    expect(h.restrictions.map((record) => record.deny)).toEqual([['web_search']]);
  });

  it('默认不装：开关关闭时对账是空操作', () => {
    const h = makeContext();
    h.presentTools.add('web_search');
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x' }));
    expect(h.restrictions).toHaveLength(0);
  });

  it('热切换：拨开补装到 live agent，拨回即撤销', () => {
    const h = makeContext();
    h.presentTools.add('web_search');
    h.presentTools.add('web_fetch');
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x' }));
    const hooks = h.installedSections[0]?.hooks;
    expect(hooks).toBeDefined();
    expect(h.restrictions).toHaveLength(0);

    hooks?.setSource(() => resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    hooks?.onChange();
    expect(h.restrictions.map((record) => record.lifted)).toEqual([false]);

    hooks?.setSource(() => resolve({ accessSecret: 'x' }));
    hooks?.onChange();
    expect(h.restrictions.map((record) => record.lifted)).toEqual([true]);
  });

  it('保存密钥触发的 onChange 不重复装（幂等）', () => {
    const h = makeContext();
    h.presentTools.add('web_search');
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    h.installedSections[0]?.hooks.onChange();
    h.installedSections[0]?.hooks.onChange();
    expect(h.restrictions).toHaveLength(1);
  });

  it('agent 销毁后销账：不再去调用一个已随 scope 撤销的 restriction', () => {
    const h = makeContext();
    h.presentTools.add('web_search');
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    h.emit('agent/disposed', { agent: { id: 'live' } });
    h.unload();
    // agent 的 scope 已经撤销了 restriction，这里再调那个 disposer 只会是多余动作。
    expect(h.restrictions.map((record) => record.lifted)).toEqual([false]);
  });

  it('卸载时撤销仍挂在 live agent 上的 restriction', () => {
    const h = makeContext();
    h.presentTools.add('web_search');
    h.services.set('agents', fakeAgents([fakeAgent('live', h.restrictions)]));
    apply(h.ctx as never, resolve({ accessSecret: 'x', disableNativeWebSearch: true }));
    expect(h.restrictions).toHaveLength(1);
    h.unload();
    expect(h.restrictions.map((record) => record.lifted)).toEqual([true]);
  });
});
