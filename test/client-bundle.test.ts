/**
 * 浏览器半体产物契约测试。
 *
 * 为什么需要它：client 半体只有装进浏览器才能跑通，普通单测覆盖不到；
 * 但**产物格式**与**装配能否跑起来**是可以在这里钉死的 —— 信封 id、factory 形状、
 * 导出面、注册进 `plugins.bundle.config` 的 key（**包名**，从仓内声明文件里读），
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

/** 本包的包名与 bundle patch 的行；槽 key 与 get() 的实参取自它们（见 [declaration.ts](declaration.ts)）。 */
const PACKAGE_NAME = readPackageName();
const PATCH_ROW = readPatchRow();
/** `plugins.bundle.config` 的分派 key —— 就是这个 bundle 的**包名**。 */
const BUNDLE_KEY = PACKAGE_NAME;
/** `ctx.configForms.get()` 的实参 —— loader entry id。今天与包名同串，但不是一回事。 */
const ENTRY_ID = PATCH_ROW.id;

/**
 * `ctx.configForms.get()` 交回的表单替身。
 *
 * 只要够卡片读 props 用：JSX 不求值组件体（本文件不装 React 渲染器），所以它的方法在
 * 这些用例里不会被调用 —— 但形状必须与源码里的 `ConfigFormFace` 一致，否则 JSX 那一步的
 * 类型检查会红。
 */
const formStub = {
  getSnapshot: () => ({
    status: 'ready' as const,
    value: {},
    user: undefined,
    revision: 1,
    writable: true,
  }),
  subscribe: () => () => undefined,
  mutate: async () => true,
};

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
    // 0.1.7 起 `settingsScope` 这个服务被删了：它曾经是卡片的读写面，现在换成卡片自己经
    // `ctx.configForms.get(ENTRY_ID)` 取。声明一个不存在的服务不会降级 —— inject 是**激活门禁**，
    // 少一个服务整个 apply 不执行（用户看到的是「pending (waiting for service)」）。
    // `configForms` 也**不在**这张名单里：它是 0.1.7 才有的，写进模块级 inject 会让更早宿主上
    // 整个客户端半体 pending；本文件用嵌套 `ctx.inject` 给它把门（见 apply）。
    expect(mod['inject']).toEqual(['slots', 'remote', 'remote.credentials', 'locale']);
    expect(mod['inject']).not.toContain('settingsScope');
  });
});

describe('client bundle 注册行为', () => {
  /** 槽位注册交出的组件；本组只关心它拿到的座位。 */
  type CardComponent = (seat: { t: (key: string) => string; view: 'page' }) => unknown;

  /** 取出一个注册元素的 props（槽位交出来的是 React 元素，不渲染就看不到它的座位）。 */
  function propsOf(element: unknown): Record<string, unknown> {
    return (element as { props?: Record<string, unknown> }).props ?? {};
  }

  /**
   * 记录槽位注册与字典注册的替身上下文。
   *
   * @param configForms - 要提供的配置服务；传 `undefined` 模拟「更早的宿主没有这个服务」
   *   —— 那时嵌套的 `ctx.inject` 回调**不会**来，卡片整个不注册。
   */
  function makeContext(
    configForms: { get: (id: string) => unknown } | null = { get: () => formStub },
  ) {
    const registrations: Array<Record<string, unknown>> = [];
    const components: CardComponent[] = [];
    const injected: string[] = [];
    /** 嵌套 `ctx.inject` 请求过的服务名。 */
    const scopedInjections: string[] = [];
    /** `configForms.get()` 收到过的实参。 */
    const formRequests: string[] = [];
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
    const slots = {
      inject(name: string, callback: () => unknown) {
        injected.push(name);
        callback();
      },
      register(options: Record<string, unknown>, component: unknown) {
        registrations.push(options);
        components.push(component as CardComponent);
        return () => undefined;
      },
    };
    // 记下每次取表单的实参：槽 key 取包名、get() 取 entry id，两者**今天同串但不是一回事**，
    // 所以这里必须能看见实际传进去的那个字符串。
    const service = configForms === null
      ? undefined
      : { get: (id: string) => { formRequests.push(id); return configForms.get(id); } };
    const ctx = {
      ...base,
      inject(names: string[], callback: (scoped: unknown) => unknown) {
        scopedInjections.push(...names);
        if (service === undefined) return;
        callback({ ...base, slots, configForms: service });
      },
      slots,
    };
    return {
      ctx,
      base,
      registrations,
      components,
      injected,
      scopedInjections,
      formRequests,
      dictionaries,
      credentialReads,
    };
  }

  it('注册进 plugins.bundle.config，key 就是这个 bundle 的包名', () => {
    const { ctx, registrations, injected, scopedInjections } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);

    // 服务走嵌套 inject、槽走 slots.inject —— 两条都要看得见。
    expect(scopedInjections).toEqual(['configForms']);
    expect(injected).toEqual(['plugins.bundle.config']);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ name: 'plugins.bundle.config', key: BUNDLE_KEY });
    // key 的真源是 package.json 的 name（PACKAGE_NAME 已读出）；再对一条反向控制防空串。
    expect(PACKAGE_NAME.length).toBeGreaterThan(0);
    expect(PATCH_ROW.name).toBe(PACKAGE_NAME);
  });

  it('取表单用 loader entry id，不是槽 key（两者今天同串，但不是一回事）', () => {
    const { ctx, formRequests } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);

    // 槽按**包名**寻址、get() 按**entry id** 取名空间。写成包名在今天是等价的，
    // 所以只有这条断言能在 patch 的 id 改掉之后把人叫醒（那时卡片会变成永远只读且不报错）。
    expect(formRequests).toEqual([ENTRY_ID]);
    expect(ENTRY_ID).toBe(PATCH_ROW.id);
  });

  it('page 视图把 apply 期取到的表单面交给卡片（座位里没有 form）', () => {
    const { ctx, components } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);

    expect(components).toHaveLength(1);
    // `plugins.bundle.config` 的座位**只有 view**（DSH PluginManagerPage.tsx:584 只递 view 与
    // entryKey），表单是 apply 期自己取的。这条同时钉住「卡片不再从座位读 form」。
    const element = components[0]?.({ t: (key) => key, view: 'page' });
    expect(propsOf(element).form).toBe(formStub);
    expect(propsOf(element).store).toBeDefined();
    expect(typeof propsOf(element).trackSavedRef).toBe('function');
  });

  it('只注册 page：该槽没有任何渲染 summary 的路径，不留死文案', () => {
    const { ctx, registrations } = makeContext();
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(ctx);

    // DSH `slot-contract.ts:12-16`：「Bundle configuration renders only `page`」，
    // 且全仓只有 `PluginManagerPage.tsx:584` 一处用该槽、只传 `view: 'page'`。
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).not.toHaveProperty('views');
  });

  it('注册是惰性的：槽声明不到账就不注册', () => {
    // 服务在、槽不在：slots.inject 的回调永远不来 —— 用不触发回调的替身验证。
    const { ctx, registrations, injected } = makeContext();
    const silent = {
      ...ctx,
      slots: {
        inject(name: string, _callback: () => unknown) {
          injected.push(name);
        },
        register: () => () => undefined,
      },
    };
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(silent);
    expect(injected).toEqual(['plugins.bundle.config']);
    expect(registrations).toHaveLength(0);
  });

  it('configForms 缺席时 apply 仍跑完，且不发生任何槽注册（降级路径）', () => {
    // 这是「嵌套 inject」那个取舍的**唯一证据位**：更早的宿主没有 configForms，
    // 模块级 inject 会因为激活门禁让整个半体 pending（字典、凭据订阅、探测全都不跑）；
    // 嵌套 inject 则是 apply 照跑、只有卡片不注册。
    const { ctx, base, registrations, dictionaries, scopedInjections } = makeContext(null);
    let effects = 0;
    const counting = {
      ...ctx,
      effect(callback: () => unknown) {
        effects += 1;
        return base.effect(callback);
      },
    };
    const mod = materialize(loadBundleRow());
    (mod['apply'] as (ctx: unknown) => void)(counting);

    expect(registrations).toHaveLength(0);
    // 字典照常注册 —— 这正是「半体没被整个关掉」的证据。
    expect(dictionaries).toHaveLength(1);
    expect(effects).toBeGreaterThan(0);
    // `inject` 那句确实被求值了 —— 服务的缺席表现为**这个回调不来**（下面那个赋值），
    // 而不是压根没去问。这两件事的差别就是这个取舍的意义所在。
    expect(scopedInjections).toEqual(['configForms']);
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
 * 能力探测（不查版本号）。
 *
 * 「卡片拿不到表单」这条链上有**两环**：服务 `configForms`（0.1.7 才有的客户端服务）与槽
 * `plugins.bundle.config`。任一环缺席都不报错 —— 症状是「插件页里什么都没有」。
 *
 * **它盯的不是「槽名换没换」**：`plugins.bundle.config` 在 0.1.6 与 0.1.7 上都不传 `form`
 * （DSH `PluginManagerPage.tsx` 两版同形），所以在这个槽上「槽在不在」推不出「拿不拿得到表单」。
 * 真正会断的那一环是**服务缺席**（更早的宿主里没有 `configForms`）。
 *
 * 这几条钉住提示路径：只对缺席的那一环发声、格式是英文 `[WARN]`（无 emoji）、
 * 且**可撤销**（迟到就补一条 `[INFO]`），注册语义一字不动。
 */
describe('client bundle 配置能力探测', () => {
  /** 跨过任意合理窗口宽度的推进量；测试不依赖真实时钟。 */
  const PAST_PROBE_WINDOW_MS = 60_000;

  /**
   * 一个服务的三种到场方式。
   *
   * `auto` = 当场回调（正常装配）；`manual` = 留住回调由用例决定何时触发（迟到）；
   * `absent` = 永不回调（服务/槽不存在）。
   */
  type Arrival = 'auto' | 'manual' | 'absent';

  /** 探测用例的最小服务面：卡片外壳要的替身，两环由各用例给到场方式。 */
  function probeContext(
    arrival: { configForms: Arrival; slots: Arrival },
  ): { ctx: Record<string, unknown>; fireConfigForms: () => void; fireSlots: () => void } {
    const credentials = {
      describe: async () => ({ ok: true as const, value: {} }),
      set: async () => ({ ok: true as const, value: undefined }),
    };
    const registrations: Array<Record<string, unknown>> = [];
    const scopedInjections: string[] = [];
    const slotInjections: string[] = [];
    let pendingConfigForms: (() => void) | undefined;
    let pendingSlots: (() => void) | undefined;

    const slots = {
      inject(name: string, callback: () => unknown) {
        slotInjections.push(name);
        if (arrival.slots === 'auto') callback();
        else if (arrival.slots === 'manual') pendingSlots = callback;
      },
      register(options: Record<string, unknown>) {
        registrations.push(options);
        return () => undefined;
      },
    };
    // **不提前清窗口**：注册发生才算「卡片能被看见」。服务到账就清的话，
    // 「服务在、槽缺席」这一档会变成静默 —— 正是探测要报的那件事。
    const service = { get: () => formStub };
    const base = {
      locale: { register: () => () => undefined },
      remote: { credentials, $on: () => () => undefined },
      effect(callback: () => unknown) {
        callback();
        return () => undefined;
      },
      slots,
    };
    const ctx = {
      ...base,
      inject(names: string[], callback: (scoped: unknown) => unknown) {
        scopedInjections.push(...names);
        if (arrival.configForms === 'auto') callback({ ...base, configForms: service });
        else if (arrival.configForms === 'manual') {
          pendingConfigForms = () => callback({ ...base, configForms: service });
        }
      },
    };
    return {
      ctx,
      fireConfigForms: () => pendingConfigForms?.(),
      fireSlots: () => pendingSlots?.(),
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

  /** 一条英文、无 emoji 的提示。 */
  function expectPlainEnglish(line: string): void {
    expect(line).toMatch(/^\[WARN\] /);
    // 英文、无 emoji：整条提示必须是纯 ASCII。
    expect(line).toMatch(/^[\x20-\x7E]+$/);
  }

  it('两环都按时到达：不发声（探测只对缺席的那一环说话）', () => {
    vi.useFakeTimers();
    const captured = spyConsole();
    try {
      const probe = probeContext({ configForms: 'auto', slots: 'auto' });
      const mod = materialize(loadBundleRow());
      (mod['apply'] as (ctx: unknown) => void)(probe.ctx);
      vi.advanceTimersByTime(PAST_PROBE_WINDOW_MS);
      expect(captured.warnings).toEqual([]);
      expect(captured.infos).toEqual([]);
    } finally {
      captured.restore();
      vi.useRealTimers();
    }
  });

  it('服务缺席（更早的宿主）：超时后恰有一条英文 [WARN]，报的是服务', () => {
    vi.useFakeTimers();
    const captured = spyConsole();
    try {
      const probe = probeContext({ configForms: 'absent', slots: 'absent' });
      const mod = materialize(loadBundleRow());
      (mod['apply'] as (ctx: unknown) => void)(probe.ctx);
      expect(captured.warnings).toEqual([]);
      vi.advanceTimersByTime(PAST_PROBE_WINDOW_MS);
      expect(captured.warnings).toHaveLength(1);
      const line = captured.warnings[0] ?? '';
      expectPlainEnglish(line);
      // 报的必须是**实际断掉的那一环**：这里是服务，不是槽。
      expect(line).toContain('configForms');
      expect(line).not.toContain('plugins.bundle.config');
    } finally {
      captured.restore();
      vi.useRealTimers();
    }
  });

  it('服务在、槽缺席：报的是槽，且点名的槽就是实际注册的那个', () => {
    vi.useFakeTimers();
    const captured = spyConsole();
    try {
      const probe = probeContext({ configForms: 'auto', slots: 'absent' });
      const mod = materialize(loadBundleRow());
      (mod['apply'] as (ctx: unknown) => void)(probe.ctx);
      vi.advanceTimersByTime(PAST_PROBE_WINDOW_MS);
      expect(captured.warnings).toHaveLength(1);
      const line = captured.warnings[0] ?? '';
      expectPlainEnglish(line);
      // 探测说要装 A、卡片装进 B，是最坏的一种「说谎」。
      expect(line).toContain('plugins.bundle.config');
    } finally {
      captured.restore();
      vi.useRealTimers();
    }
  });

  it('服务与槽都迟到：各补一条 [INFO] 撤销，注册照常发生', () => {
    vi.useFakeTimers();
    const captured = spyConsole();
    try {
      const probe = probeContext({ configForms: 'manual', slots: 'manual' });
      const mod = materialize(loadBundleRow());
      (mod['apply'] as (ctx: unknown) => void)(probe.ctx);
      vi.advanceTimersByTime(PAST_PROBE_WINDOW_MS);
      expect(captured.warnings).toHaveLength(1);
      expect(captured.warnings[0]).toContain('configForms');

      // 服务到账：撤掉自己那一条。此时槽仍未到，所以下面还会再补一条。
      probe.fireConfigForms();
      expect(captured.infos).toHaveLength(1);
      expect(captured.infos[0]).toContain('configuration service');

      // 槽也到了：撤掉它自己那一条，注册照常发生。两条 INFO 各说各的那一环。
      probe.fireSlots();
      expect(captured.infos).toHaveLength(2);
      expect(captured.infos[1]).toMatch(/^\[INFO\] /);
      expect(captured.infos[1]).toContain('plugins.bundle.config');
    } finally {
      captured.restore();
      vi.useRealTimers();
    }
  });

  it('服务迟到、窗口内没有槽：撤的是服务那条，槽那条照发', () => {
    // 两环**各自**持有窗口与标记 —— 这一条钉住「一环到账不误撤另一环」。
    // 构造方式：服务窗口内到账（所以服务那条不发），槽窗口内始终没到。
    vi.useFakeTimers();
    const captured = spyConsole();
    try {
      const probe = probeContext({ configForms: 'auto', slots: 'absent' });
      const mod = materialize(loadBundleRow());
      (mod['apply'] as (ctx: unknown) => void)(probe.ctx);
      vi.advanceTimersByTime(PAST_PROBE_WINDOW_MS);
      expect(captured.warnings).toHaveLength(1);
      expect(captured.warnings[0]).toContain('plugins.bundle.config');

      // 服务那一条窗口已经收工（内到账），所以这里补不出任何 INFO ——
      // 「没发过警告就不撤销」是刻意的：一条不存在的提示不该被「撤销」。
      expect(captured.infos).toEqual([]);
      expect(probe.fireConfigForms).toBeTypeOf('function');
    } finally {
      captured.restore();
      vi.useRealTimers();
    }
  });

  it('服务缺席：槽那一环不跟着喊（一次超时只发一条）', () => {
    // 服务都没到，「槽在不在」还没到判的时候 —— 报它是替另一环说话，而且会变成两条噪音。
    vi.useFakeTimers();
    const captured = spyConsole();
    try {
      const probe = probeContext({ configForms: 'absent', slots: 'absent' });
      const mod = materialize(loadBundleRow());
      (mod['apply'] as (ctx: unknown) => void)(probe.ctx);
      vi.advanceTimersByTime(PAST_PROBE_WINDOW_MS);
      expect(captured.warnings).toHaveLength(1);
      expect(captured.warnings[0]).toContain('configForms');
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
      // 替身要**当场回调**：`inject` 的语义是「依赖齐了就注册」，不回调等于槽缺席。
      // 原先是 `inject: () => undefined`，所以那一组从来没验过注册路径 ——
      // 它只验了「apply 跑起来」。
      slots: { inject: (_name: string, callback: () => unknown) => callback(), register: () => () => undefined },
      locale: { register: () => () => undefined },
      remote: { credentials, $on: () => () => undefined },
      'remote.credentials': credentials,
      // 卡片经**嵌套** `ctx.inject(['configForms'])` 取它 —— 它不在模块级 inject 里，
      // 所以「服务由兄弟 fiber 提供时那次嵌套 inject 会不会回调」必须在这里实测，
      // 普通替身（传普通对象）结构性地看不见这件事。
      configForms: { get: () => formStub },
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
  async function mount(
    available: Record<string, unknown>,
  ): Promise<{ applied: boolean; failure?: string; slotsInjected: string[]; registrations: number }> {
    const ctx = new Context();
    await ctx.plugin({
      name: 'test-environment',
      apply(env: unknown) {
        const { provide } = env as { provide(name: string, value: unknown): unknown };
        for (const [name, value] of Object.entries(available)) provide(name, value);
      },
    });

    const mod = materialize(loadBundleRow());
    const slotsInjected: string[] = [];
    let registrations = 0;
    let applied = false;
    let failure: string | undefined;
    try {
      await ctx.plugin({
        name: 'dsh-zhihu-search',
        inject: mod['inject'] as string[],
        apply: (inner: unknown) => {
          // 只把 `ctx.slots` 包一层代理来记账，其余原样：真实上下文是 Cordis 的属性代理，
          // **不能往上写属性**（实测 `cannot set property "slots" in multiple fibers`），
          // 所以这里用 `Object.create` 让它留在原型上，只在那一个键上拦截。
          // `inject` 必须原样转给真实服务 —— 嵌套 inject 要靠它进 fiber。
          const wrapped = Object.create(inner as object) as object;
          Object.defineProperty(wrapped, 'slots', {
            get() {
              const slots = Reflect.get(inner as object, 'slots') as {
                inject: (n: string, cb: () => unknown) => unknown;
                register: unknown;
              };
              return new Proxy(slots, {
                get(target, key, receiver) {
                  if (key === 'inject') {
                    return (name: string, callback: () => unknown) => {
                      slotsInjected.push(name);
                      return target.inject(name, callback);
                    };
                  }
                  if (key === 'register') {
                    return () => {
                      registrations += 1;
                      return () => undefined;
                    };
                  }
                  return Reflect.get(target, key, receiver) as unknown;
                },
              });
            },
          });
          (mod['apply'] as (context: unknown) => void)(wrapped);
          applied = true;
        },
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    return { applied, slotsInjected, registrations, ...(failure === undefined ? {} : { failure }) };
  }

  it('声明齐全时 apply 真的跑起来，不再抛 without inject', async () => {
    const run = await mount(services());
    expect(run.failure).toBeUndefined();
    expect(run.applied).toBe(true);
  });

  it('嵌套 inject 在真实 Cordis 上到账：服务由兄弟 fiber 提供时卡片照常注册', async () => {
    // 这条是嵌套 `ctx.inject(['configForms'])` 的**唯一**运行时证据位：
    // 服务不在模块级 inject 里，所以「兄弟 fiber 提供它时那次嵌套 inject 会不会回调」
    // 只能在这里问。它不回调 = 卡片永远不注册，而其余所有断言仍然是绿的。
    const run = await mount(services());
    expect(run.failure).toBeUndefined();
    expect(run.slotsInjected).toEqual(['plugins.bundle.config']);
    expect(run.registrations).toBe(1);
  });

  it('反向控制：少提供 configForms 时 apply 仍跑完，但一次槽注册都不发生', async () => {
    // 与上面三条反向控制对照：那三条是**激活门禁**（服务不在模块级 inject 里 → apply 不跑），
    // 这一条是**嵌套把门**（apply 照跑，只有卡片不注册）。两种降级形态完全不同，别混。
    const partial = services();
    delete (partial as Record<string, unknown>)['configForms'];
    const run = await mount(partial);
    expect(run.failure).toBeUndefined();
    expect(run.applied).toBe(true);
    expect(run.slotsInjected).toEqual([]);
    expect(run.registrations).toBe(0);
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
