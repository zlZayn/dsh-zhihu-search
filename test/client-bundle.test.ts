/**
 * 浏览器半体产物契约测试。
 *
 * 为什么需要它：client 半体只有装进浏览器才能跑通，普通单测覆盖不到；
 * 但**产物格式**与**装配能否跑起来**是可以在这里钉死的 —— 信封 id、factory 形状、
 * 导出面、注册进 `plugins.bundle.config` 的 key（等于本包包名），以及本模块最后那组
 * 「按真实 Cordis 语义挂载」。这几处任何一处错了，
 * 症状都是「插件页里什么都没有」，排查代价极高。
 *
 * 依赖 `lib/client.js` 已构建（`npm test` 会先跑 build）。
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { Context } from '@deepseek-ai/cordis';
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
    // `remote` 与 `remote.credentials` 都必须有：前者让 `ctx.remote` 属性访问合法，
    // 后者等命名空间就绪。漏掉 `remote` 会让整张卡片装不上（见本文件最后一组测试）。
    expect(mod['inject']).toEqual(['slots', 'settingsScope', 'remote', 'remote.credentials', 'locale']);
  });
});

describe('client bundle 注册行为', () => {
  /** 槽位注册交出的组件；本组只关心它的 view 分支返回值。 */
  type CardComponent = (seat: { t: (key: string) => string; view: 'summary' | 'page' }) => unknown;

  /** 记录槽位注册与字典注册的替身上下文。 */
  function makeContext() {
    const registrations: Array<Record<string, unknown>> = [];
    const components: CardComponent[] = [];
    const injected: string[] = [];
    const dictionaries: Array<{ ns: string; locales: string[] }> = [];
    /** 读凭据域的记账。写路径由 [credential-store 单测](credential-store.test.ts) 覆盖。 */
    const credentialReads: string[][] = [];
    const scope = {
      subscribe: () => () => undefined,
      getSnapshot: () => ({ status: 'ready', writable: true, value: undefined, user: undefined, base: undefined }),
      set: async () => undefined,
      unset: async () => undefined,
    };
    const remote = {
      credentials: {
        describe: async (refs: readonly string[]) => {
          credentialReads.push([...refs]);
          return { ok: true as const, value: {} };
        },
        set: async () => ({ ok: true as const, value: undefined }),
      },
      $on: () => () => undefined,
    };
    /** 卡片在 apply 期就需要 effect、locale 与 remote，缺任一项都会让它抛错。 */
    const base = {
      settingsScope: { bind: () => scope },
      locale: {
        register(ns: string, dicts: Record<string, unknown>) {
          dictionaries.push({ ns, locales: Object.keys(dicts) });
          return () => undefined;
        },
      },
      remote,
      effect(callback: () => unknown) {
        callback();
        return () => undefined;
      },
    };
    const ctx = {
      ...base,
      slots: {
        inject(name: string, callback: () => unknown) {
          injected.push(name);
          callback();
        },
        register(options: Record<string, unknown>, component: unknown) {
          registrations.push(options);
          components.push(component as CardComponent);
          return () => undefined;
        },
      },
    };
    return { ctx, base, registrations, components, injected, dictionaries, credentialReads };
  }

  it('注册进 plugins.bundle.config，且 key 等于本包包名', () => {
    const { ctx, registrations, injected } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);

    expect(injected).toEqual(['plugins.bundle.config']);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ name: 'plugins.bundle.config', key: 'dsh-zhihu-search' });
  });

  it('该槽只被要求 page：summary 视图返回空而不是抛错', () => {
    const { ctx, components } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);

    expect(components).toHaveLength(1);
    // summary 分支不渲染表单，因此不碰 React —— 表单组件带 hook，直接调用会抛「Invalid hook call」，
    // 断言它**没有**走到那一步正是这条用例的区分力所在。
    expect(components[0]?.({ t: (key) => key, view: 'summary' })).toBeNull();
  });

  it('注册是惰性的：只在声明到账后才发生', () => {
    const { base, registrations } = makeContext();
    // 槽位声明缺席时 inject 不应回调 —— 用不触发回调的替身验证。
    const silent = {
      ...base,
      slots: { inject: () => undefined, register: () => () => undefined },
    };
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(silent);
    expect(registrations).toHaveLength(0);
  });

  it('注册时声明 locale 命名空间，框架才会注入 t 座位', () => {
    const { ctx, registrations } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);
    expect(registrations[0]).toMatchObject({ locale: 'zhihu-search' });
  });

  it('中英字典一起注册：缺一种语言应表现为编译错误，而不是线上空白', () => {
    const { ctx, dictionaries } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);
    expect(dictionaries).toHaveLength(1);
    expect(dictionaries[0]?.ns).toBe('zhihu-search');
    expect(dictionaries[0]?.locales.slice().sort()).toEqual(['en', 'zh']);
  });

  it('装配时就查一次凭据域，且用的是默认引用名', () => {
    const { ctx, credentialReads } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);
    expect(credentialReads).toEqual([['ZHIHU_ACCESS_SECRET']]);
  });
});

/**
 * 按**真实 Cordis 语义**挂载产物。
 *
 * 为什么上面那些替身不够：它们传的是**普通对象**，Cordis 的属性代理根本没参与，
 * 于是「inject 声明」这道运行时门禁在测试里完全不存在 —— v1.6.0 就是这样漏出去的：
 * `inject` 里只有点号键 `remote.credentials`，而 `ctx.remote` 是属性访问，
 * 线上抛 `cannot get property "remote" without inject`，卡片整个装不上，
 * 而此处所有断言全绿。
 *
 * 钉住两条等价关系（机制见 Cordis `lib/index.js` 的 `ReflectService.handler.get`）：
 * - **点号键不等于声明了父级**：属性访问要求服务名逐字出现在某个 fiber 的 `inject` 里。
 * - **服务缺席时 fiber 静默不激活**：不会抛错，只有「没跑过」这一个信号，
 *   所以断言必须是「apply 真的跑到了」。
 */
describe('client bundle 按真实 Cordis 语义装配', () => {
  /** 卡片需要的最小服务面。键就是 Cordis 服务名，点号键也照实提供。 */
  function services() {
    const scope = {
      subscribe: () => () => undefined,
      getSnapshot: () => ({ status: 'ready', writable: true, value: undefined, user: undefined, base: undefined }),
      set: async () => undefined,
      unset: async () => undefined,
    };
    const credentials = {
      describe: async () => ({ ok: true as const, value: {} }),
      set: async () => ({ ok: true as const, value: undefined }),
    };
    return {
      slots: { inject: () => undefined, register: () => () => undefined },
      locale: { register: () => () => undefined },
      settingsScope: { bind: () => scope },
      remote: { credentials, $on: () => () => undefined },
      'remote.credentials': credentials,
    };
  }

  /**
   * 把产物挂到真实 Context 上。
   *
   * 注入声明取**产物自己导出的** `inject`：测试不替它挑依赖，
   * 只回答「拿着这份声明，装配跑得起来吗」。
   *
   * 服务由**兄弟** fiber 提供，而不是 `ctx.provide` 挂在根上 —— 位置决定这道门禁存不存在：
   * 提供者是祖先时，Cordis 的查找会在 `fiber.store` 命中就直接返回，
   * 未声明的依赖照样属性访问得到，测试于是假绿。真实装配里服务与插件分属不同分支，
   * 只有 inject 这一条路可走，所以这里必须照那个拓扑摆。
   *
   * @param available - 要提供哪些服务；用来对比「少一个会怎样」。
   * @returns 是否真的执行到了 `apply`。
   */
  async function mount(available: Record<string, unknown>): Promise<{ applied: boolean; failure?: string }> {
    const ctx = new Context();
    await ctx.plugin({
      name: 'test-environment',
      apply(env: unknown) {
        const { provide } = env as { provide(name: string, value: unknown): unknown };
        for (const [name, value] of Object.entries(available)) provide(name, value);
      },
    });

    const mod = materialize(loadBundleRow());
    let applied = false;
    let failure: string | undefined;
    try {
      await ctx.plugin({
        name: 'dsh-zhihu-search',
        inject: mod['inject'] as string[],
        apply: (inner: unknown) => {
          (mod['apply'] as (context: unknown) => void)(inner);
          applied = true;
        },
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    return failure === undefined ? { applied } : { applied, failure };
  }

  it('声明齐全时 apply 真的跑起来，不再抛 without inject', async () => {
    const run = await mount(services());
    expect(run.failure).toBeUndefined();
    expect(run.applied).toBe(true);
  });

  it('反向控制：少提供 remote 时 apply 不跑（证明上面那条断言有区分力）', async () => {
    const partial = services();
    delete (partial as Record<string, unknown>)['remote'];
    expect((await mount(partial)).applied).toBe(false);
  });

  it('反向控制：少提供 remote.credentials 时也不跑（点号键受同一道门禁）', async () => {
    const partial = services();
    delete (partial as Record<string, unknown>)['remote.credentials'];
    expect((await mount(partial)).applied).toBe(false);
  });

  it('反向控制：少提供 settingsScope 时也不跑', async () => {
    const partial = services();
    delete (partial as Record<string, unknown>)['settingsScope'];
    expect((await mount(partial)).applied).toBe(false);
  });
});
