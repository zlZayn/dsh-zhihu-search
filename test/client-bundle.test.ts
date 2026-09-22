/**
 * 浏览器半体产物契约测试。
 *
 * 为什么需要它：client 半体只有装进浏览器才能跑通，普通单测覆盖不到；
 * 但**产物格式**与**装配能否跑起来**是可以在这里钉死的 —— 信封 id、factory 形状、
 * 导出面、注册进 `plugins.row.config` 的 key（`<包名>#<行 id>`，两半都从仓内声明文件里读），
 * 以及本模块最后那组「按真实 Cordis 语义挂载」。这几处任何一处错了，
 * 症状都是「插件页里什么都没有」，排查代价极高。
 *
 * 依赖 `lib/client.js` 已构建（`npm test` 会先跑 build）。
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it, vi } from 'vitest';
import { readPackageName, readPatchRow } from './declaration.js';

const require_ = createRequire(import.meta.url);

/** 本包的包名与 bundle patch 的行；key 由它们拼出来（见 [declaration.ts](declaration.ts)）。 */
const PACKAGE_NAME = readPackageName();
const PATCH_ROW = readPatchRow();
const ROW_KEY = `${PACKAGE_NAME}#${PATCH_ROW.id}`;

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
    expect(loadBundleRow().id).toBe(PACKAGE_NAME);
  });

  it('导出 apply 与 inject，且 inject 里没有任何已删的服务名', () => {
    const mod = materialize(loadBundleRow());
    expect(typeof mod['apply']).toBe('function');
    // `remote` 与 `remote.credentials` 都必须有：前者让 `ctx.remote` 属性访问合法，
    // 后者等命名空间就绪。漏掉 `remote` 会让整张卡片装不上（见本文件最后一组测试）。
    //
    // 0.1.7 起 `settingsScope` 这个服务被删了：它曾经是卡片的读写面，现在换成宿主经槽位
    // props 递过来的 `form`。声明一个不存在的服务不会降级 —— inject 是**激活门禁**，
    // 少一个服务整个 apply 不执行（用户看到的是「pending (waiting for service)」）。
    expect(mod['inject']).toEqual(['slots', 'remote', 'remote.credentials', 'locale']);
    expect(mod['inject']).not.toContain('settingsScope');
  });
});

describe('client bundle 注册行为', () => {
  /** 槽位注册交出的组件；本组只关心它的 view 分支返回值。 */
  type CardComponent = (seat: { t: (key: string) => string; view: 'summary' | 'page'; form?: unknown }) => unknown;

  /** 取出一个注册元素的 props（槽位交出来的是 React 元素，不渲染就看不到它的座位）。 */
  function propsOf(element: unknown): Record<string, unknown> {
    return (element as { props?: Record<string, unknown> }).props ?? {};
  }

  /** 记录槽位注册与字典注册的替身上下文。 */
  function makeContext() {
    const registrations: Array<Record<string, unknown>> = [];
    const components: CardComponent[] = [];
    const injected: string[] = [];
    const dictionaries: Array<{ ns: string; locales: string[] }> = [];
    /** 读凭据域的记账。写路径由 [credential-store 单测](credential-store.test.ts) 覆盖。 */
    const credentialReads: string[][] = [];
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
    /** 卡片的 apply 期需要 effect、locale 与 remote，缺任一项都会让它抛错。 */
    const base = {
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

  it('注册进 plugins.row.config，key 逐字等于「包名#行 id」', () => {
    const { ctx, registrations, injected } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);

    expect(injected).toEqual(['plugins.row.config']);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ name: 'plugins.row.config', key: ROW_KEY });
    // 反向控制：那两个文件真的能拼出这个 key —— 而不是这边写死一个、那边也写死一个。
    // 行 id 与包名今天恰好同名，所以这条同时钉住「patch 的 name 必须等于本包包名」。
    expect(PATCH_ROW.name).toBe(PACKAGE_NAME);
    expect(ROW_KEY).toBe('dsh-zhihu-search#dsh-zhihu-search');
  });

  it('page 视图把宿主的 form 座位原样交给卡片，summary 视图交出行描述', () => {
    const { ctx, components } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);

    expect(components).toHaveLength(1);
    const form = { state: { status: 'ready', writable: true }, mutate: async () => true };

    // page 分支交出的是卡片元素（JSX 不求值组件体，所以这里不碰 React）；
    // 断言的是**座位透传**：宿主给的 form 必须原样进去，不能在调用点上被解引用 ——
    // `seat.form.state` 这种写法在 form 缺席时就是一次 TypeError，整块页面白屏。
    expect(propsOf(components[0]?.({ t: (key) => key, view: 'page', form })).form).toBe(form);

    // summary 分支不渲染表单，只回一行文案：插件管理页拿它当**行缺描述时的回退**
    // （DSH `PluginManagerPage.tsx:496`），本插件 patch 的行没有 description，所以一定可见。
    expect(components[0]?.({ t: (key) => key, view: 'summary' })).toBe('rowSummary');
  });

  it('form 缺席时不抛错：原样透传 undefined（宿主还没描述好，或这一行不可配置）', () => {
    const { ctx, components } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);

    // 两种成因表现相同：这一行不在 describe 镜像里（没有 volatile 字段、或连接是 memory 模式），
    // 或者描述还没回来。卡片按「不可写」渲染，注册这条路径不该有任何区别。
    const element = components[0]?.({ t: (key) => key, view: 'page' });
    expect(propsOf(element).form).toBeUndefined();
    expect(propsOf(element).store).toBeDefined();
    expect(typeof propsOf(element).trackSavedRef).toBe('function');
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

  it('装配期不读凭据域：那次读随卡片挂载发生', () => {
    // 0.1.7 起引用名的**生效值**只有卡片看得到（form 由页面在渲染期才算），
    // 所以读凭据域的动作搬进了卡片的 useEffect：先回传引用名，再重读。
    // 装配期读的话，读到的只会是默认名 —— 一个可能已经不对的答案。
    const { ctx, credentialReads } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);
    expect(credentialReads).toEqual([]);
  });
});

/**
 * 配置槽的能力探测（不查版本号）。
 *
 * 槽缺席时 `ctx.slots.inject` 的回调永远不来，且宿主不报错 —— 症状是「插件页里什么都没有」。
 * 它盯的是一个**真实故障**：宿主把本插件当普通 entry 挂载（不是 bundle 行）时没有行、
 * 没有 Configure 控件。这三条钉住提示路径：只对缺席的宿主发声、格式是英文 `[WARN]`（无 emoji）、
 * 且**可撤销**（槽迟到就补一条 `[INFO]`），注册语义一字不动。
 */
describe('client bundle 配置槽能力探测', () => {
  /** 跨过任意合理窗口宽度的推进量；测试不依赖真实时钟。 */
  const PAST_PROBE_WINDOW_MS = 60_000;

  /** 探测用例的最小服务面：卡片外壳要的替身，槽由各用例自己给。 */
  function probeContext(slots: { inject: unknown; register: unknown }): Record<string, unknown> {
    const credentials = {
      describe: async () => ({ ok: true as const, value: {} }),
      set: async () => ({ ok: true as const, value: undefined }),
    };
    return {
      locale: { register: () => () => undefined },
      remote: { credentials, $on: () => () => undefined },
      effect(callback: () => unknown) {
        callback();
        return () => undefined;
      },
      slots,
    };
  }

  /** 捕获控制台输出，返回恢复函数与两条通道。 */
  function spyConsole(): { warnings: string[]; infos: string[]; restore: () => void } {
    const warnings: string[] = [];
    const infos: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
    const infoSpy = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      infos.push(args.map(String).join(' '));
    });
    return {
      warnings,
      infos,
      restore: () => {
        warnSpy.mockRestore();
        infoSpy.mockRestore();
      },
    };
  }

  it('槽声明按时到达：不发声（探测只对缺席的宿主说话）', () => {
    vi.useFakeTimers();
    const captured = spyConsole();
    try {
      const ctx = probeContext({
        inject: (_name: string, callback: () => unknown) => {
          callback();
          return () => undefined;
        },
        register: () => () => undefined,
      });
      const mod = materialize(loadBundleRow());
      (mod['apply'] as (ctx: unknown) => void)(ctx);
      vi.advanceTimersByTime(PAST_PROBE_WINDOW_MS);
      expect(captured.warnings).toEqual([]);
      expect(captured.infos).toEqual([]);
    } finally {
      captured.restore();
      vi.useRealTimers();
    }
  });

  it('槽声明缺席：超时后恰有一条英文 [WARN]，不注册也不抛错', () => {
    vi.useFakeTimers();
    const captured = spyConsole();
    try {
      let silentRegistrations = 0;
      const silent = probeContext({
        inject: () => undefined,
        register: () => {
          silentRegistrations += 1;
          return () => undefined;
        },
      });
      const mod = materialize(loadBundleRow());
      (mod['apply'] as (ctx: unknown) => void)(silent);
      expect(captured.warnings).toEqual([]);
      vi.advanceTimersByTime(PAST_PROBE_WINDOW_MS);
      expect(captured.warnings).toHaveLength(1);
      const line = captured.warnings[0] ?? '';
      expect(line).toMatch(/^\[WARN\] /);
      // 英文、无 emoji：整条提示必须是纯 ASCII。
      expect(line).toMatch(/^[\x20-\x7E]+$/);
      // 文案里点名的槽必须是实际注册的那个 —— 探测说要装 A、卡片装进 B，是最坏的一种「说谎」。
      expect(line).toContain('plugins.row.config');
      expect(silentRegistrations).toBe(0);
    } finally {
      captured.restore();
      vi.useRealTimers();
    }
  });

  it('槽迟于窗口才声明：补一条 [INFO] 撤销提示，注册照常发生', () => {
    vi.useFakeTimers();
    const captured = spyConsole();
    try {
      const registrations: Array<Record<string, unknown>> = [];
      let pending: (() => unknown) | undefined;
      const late = probeContext({
        inject: (_name: string, callback: () => unknown) => {
          pending = callback;
          return () => undefined;
        },
        register: (options: Record<string, unknown>) => {
          registrations.push(options);
          return () => undefined;
        },
      });
      const mod = materialize(loadBundleRow());
      (mod['apply'] as (ctx: unknown) => void)(late);
      vi.advanceTimersByTime(PAST_PROBE_WINDOW_MS);
      expect(captured.warnings).toHaveLength(1);
      expect(typeof pending).toBe('function');
      pending?.();
      expect(captured.infos).toHaveLength(1);
      expect(captured.infos[0]).toMatch(/^\[INFO\] /);
      expect(registrations).toHaveLength(1);
      expect(registrations[0]).toMatchObject({ name: 'plugins.row.config', key: ROW_KEY });
    } finally {
      captured.restore();
      vi.useRealTimers();
    }
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
    const credentials = {
      describe: async () => ({ ok: true as const, value: {} }),
      set: async () => ({ ok: true as const, value: undefined }),
    };
    return {
      slots: { inject: () => undefined, register: () => () => undefined },
      locale: { register: () => () => undefined },
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

  it('反向控制：少提供 locale 时也不跑', async () => {
    const partial = services();
    delete (partial as Record<string, unknown>)['locale'];
    expect((await mount(partial)).applied).toBe(false);
  });
});
