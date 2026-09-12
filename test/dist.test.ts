/**
 * 编译产物自洽测试。
 *
 * 为什么需要它：其余测试全部从 `src/` 导入（vitest 直接跑 TypeScript），
 * 因此**从不加载 `lib/` 里的编译结果**。曾发生过一次这样的事故：
 * 浏览器半体的打包输出 `lib/client.js` 与 host 传输层 `src/client.ts` 的
 * 编译产物同名，前者把后者覆盖，`lib/utils/errors.js` 于是从浏览器信封里
 * 取 `ZhihuClientError`，DSH 启动直接 SyntaxError 崩溃 —— 而当时 142 条测试全绿。
 *
 * 本文件补上那个缺口：只加载编译后的模块，验证整张依赖图能在 Node 里求值。
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const libUrl = (name: string): URL => new URL(`../lib/${name}`, import.meta.url);

describe('编译后的 host 图可在 Node 中求值', () => {
  it('lib/utils/errors.js 能导入（曾因 ../client.js 被覆盖而崩溃）', async () => {
    const mod = (await import(libUrl('utils/errors.js').href)) as { mapError?: unknown };
    expect(typeof mod.mapError).toBe('function');
  });

  it('lib/transport.js 提供 host 传输层导出', async () => {
    const mod = (await import(libUrl('transport.js').href)) as Record<string, unknown>;
    expect(typeof mod['ZhihuClient']).toBe('function');
    expect(typeof mod['ZhihuClientError']).toBe('function');
    expect(mod['ZHIHU_BASE_URL']).toBe('https://developer.zhihu.com');
  });

  it('lib/index.js 是 host 入口，导出插件面', async () => {
    const mod = (await import(libUrl('index.js').href)) as Record<string, unknown>;
    expect(mod['name']).toBe('zhihu-search');
    expect(mod['inject']).toEqual(['tools']);
    expect(typeof mod['apply']).toBe('function');
    expect(typeof mod['Config']).toBe('function');
  });

  it('编译后的 apply 能完成装配', async () => {
    const mod = (await import(libUrl('index.js').href)) as {
      apply: (ctx: unknown, config: unknown) => void;
      Config: (input: unknown) => unknown;
    };
    const registered: string[] = [];
    const ctx = {
      tools: { register: (d: { name: string }) => { registered.push(d.name); return () => undefined; } },
      settings: { installSection: () => undefined },
      inject: (_s: string[], cb: (c: unknown) => void) => { cb(ctx); },
      get: () => undefined,
      effect: (fn: () => unknown) => { fn(); return { dispose: async () => undefined }; },
      logger: { warn: () => undefined },
    };
    mod.apply(ctx, mod.Config({ accessSecret: 'x' }));
    expect(registered).toEqual(['zhihu_search', 'zhihu_global_search', 'zhihu_zhida']);
  });
});

describe('两半体产物不抢同一路径', () => {
  it('lib/client.js 是浏览器信封', () => {
    expect(readFileSync(libUrl('client.js'), 'utf8')).toContain('window.__ModuleLoader__.load');
  });

  it('host 传输层落在 lib/transport.js，且不是信封', () => {
    expect(existsSync(fileURLToPath(libUrl('transport.js')))).toBe(true);
    expect(readFileSync(libUrl('transport.js'), 'utf8')).not.toContain('__ModuleLoader__');
  });
});
