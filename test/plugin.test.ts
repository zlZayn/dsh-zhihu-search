/**
 * 插件装配测试。
 *
 * 覆盖 `apply` 本身 —— 生命周期、设置命名空间、配置默认值、按开关注册、effect 释放。
 * 这里用最小替身 Context，**不修改维护者的真实 DSH profile**。
 */

import { describe, expect, it } from 'vitest';
import { Config as ConfigSchema, ZHIHU_SETTINGS_NAMESPACE, apply, inject, name } from '../src/index.js';
import type { Config } from '../src/index.js';

/** 记录注册、设置命名空间与 effect 的最小 Context 替身。 */
function makeContext() {
  const registered: string[] = [];
  const installedSections: Array<{ ns: string; entry: unknown }> = [];
  const liveDisposers: Array<() => void> = [];
  const warnings: string[] = [];
  const services = new Map<string, unknown>();

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
    },
    settings: {
      installSection(_owner: unknown, ns: string, _schema: unknown, entry: unknown) {
        installedSections.push({ ns, entry });
      },
    },
    // cordis 的 inject 以派生上下文回调；替身直接回传自身。
    inject(_services: string[], callback: (derived: unknown) => void) {
      callback(ctx);
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
    /** 触发 effect 的 disposer，模拟插件卸载。 */
    unload: () => {
      for (const dispose of liveDisposers) dispose();
    },
  };
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
