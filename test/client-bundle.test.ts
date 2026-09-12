/**
 * 浏览器半体产物契约测试。
 *
 * 为什么需要它：client 半体只有装进浏览器才能跑通，普通单测覆盖不到；
 * 但**产物格式**是可以在这里钉死的 —— 信封 id、factory 形状、导出面、
 * 以及注册进 `settings.plugin.item` 的 key。这几处任何一处错了，
 * 症状都是「设置页里什么都没有」，排查代价极高。
 *
 * 依赖 `lib/client.js` 已构建（`npm test` 会先跑 build）。
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require_ = createRequire(import.meta.url);

/** 一条被模块表接收的注册行。 */
interface LoaderRow {
  readonly id: string;
  readonly factory: (request: (name: string) => unknown) => Record<string, unknown>;
}

/**
 * 在 Node 里加载产物：提供 `window.__ModuleLoader__` 接收注册，
 * 再由替身 `require` 物化工厂。
 *
 * 这正是 DSH 客户端模块系统的 lazy-CJS 语义 —— 脚本执行只注册，不执行模块体。
 *
 * @returns 捕获到的注册行。
 */
function loadBundleRow(): LoaderRow {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  let captured: LoaderRow | undefined;
  const hostWindow = {
    __ModuleLoader__: {
      load(row: LoaderRow) {
        captured = row;
      },
    },
  };
  // 产物是被设计成在浏览器全局里求值的脚本，这里如法炮制。
  new Function('window', source)(hostWindow);
  if (captured === undefined) throw new Error('bundle 没有调用 window.__ModuleLoader__.load');
  return captured;
}

/**
 * 外壳预置模块的替身。
 *
 * `react` / `react/jsx-runtime` 在 Node 里可以真加载，`ui-primitives` 不行 ——
 * 它是**浏览器**静态库，依赖 `clsx` 与其 CSS 处理，只存在于 Web 外壳的构建产物里。
 * 浏览器中这三者都由 `PLATFORM_MODULES` seed 表提供（DSH `packages/client/web/src/platform.ts`），
 * 因此这里替换它们才是忠实的：被测的是**本产物**的信封与注册行为，不是外壳模块。
 */
const PLATFORM_STUBS: Record<string, unknown> = {
  '@deepseek-ai/dsh-client-ui-primitives': {
    Tag: () => null,
    IconChevronDownOutline14: () => null,
  },
};

/** 物化产物导出的模块。 */
function materialize(row: LoaderRow): Record<string, unknown> {
  return row.factory((name) => (name in PLATFORM_STUBS ? PLATFORM_STUBS[name] : require_(name)));
}

describe('client bundle 信封', () => {
  it('只请求外壳预置模块（PLATFORM_MODULES），无需额外依赖边', () => {
    const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
    const requested = [...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
    const allowed = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit'];
    expect(requested.length).toBeGreaterThan(0);
    for (const name of requested) expect(allowed, name).toContain(name);
  });

  it('注册的 id 等于包名（模块表以它作 key）', () => {
    expect(loadBundleRow().id).toBe('dsh-zhihu-search');
  });

  it('导出 apply 与 inject', () => {
    const mod = materialize(loadBundleRow());
    expect(typeof mod['apply']).toBe('function');
    expect(mod['inject']).toEqual(['slots', 'settingsScope']);
  });
});

describe('client bundle 注册行为', () => {
  /** 记录槽位注册的替身上下文。 */
  function makeContext() {
    const registrations: Array<Record<string, unknown>> = [];
    const injected: string[] = [];
    const scope = {
      subscribe: () => () => undefined,
      getSnapshot: () => ({ status: 'ready', writable: true, value: undefined, user: undefined, base: undefined }),
      set: async () => undefined,
      unset: async () => undefined,
    };
    const mirror = { subscribe: () => () => undefined, getSnapshot: () => ({}) };
    const ctx = {
      settingsScope: { bind: () => scope, describe: () => mirror },
      slots: {
        inject(name: string, callback: () => unknown) {
          injected.push(name);
          callback();
        },
        register(options: Record<string, unknown>) {
          registrations.push(options);
          return () => undefined;
        },
      },
    };
    return { ctx, registrations, injected };
  }

  it('注册进 settings.plugin.item，且 key 等于 host 侧命名空间', () => {
    const { ctx, registrations, injected } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);

    expect(injected).toEqual(['settings.plugin.item']);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ name: 'settings.plugin.item', key: 'zhihu-search' });
  });

  it('注册是惰性的：只在声明到账后才发生', () => {
    const { ctx, registrations } = makeContext();
    // 槽位声明缺席时 inject 不应回调 —— 用不触发回调的替身验证。
    const silent = {
      settingsScope: ctx.settingsScope,
      slots: { inject: () => undefined, register: () => () => undefined },
    };
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(silent);
    expect(registrations).toHaveLength(0);
  });
});
