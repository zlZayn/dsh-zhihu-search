/**
 * 「隐藏原生网页工具」的实现级回归：用**真实的工具注册表与真实 scope 链**，
 * 复现 web profile 的装配形态。
 *
 * 为什么 `test/plugin.test.ts` 的替身测不出这个故障：那里的 `tools.get()` 是我手写的替身，
 * 永远按我的假设回答。真实装配里，原生工具注册在 **agent preset 的 standing scope** 上 ——
 * DSH `bundle/web-app/cordis.patch.yml:470` 关掉了 base bundle 的全局 `tool-web` 行，
 * `preset/agent-presets/src/index.ts:3-12` 把 agent 的 scope parent 到该挂载点 ——
 * 于是**根上下文的全局视图看不到它们**。v1.3.0 正是栽在这个假设上：预检查得到空集合 →
 * 静默什么都不做 → 开关存成 true 也没有任何效果。
 *
 * 本文件因此也顺带钉住两条真实平台约束：服务访问要声明 `inject`，以及注册必须发生在
 * 正确的 scope 上。
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import * as zhihu from '../src/index.js';
import { Config as ConfigSchema } from '../src/index.js';
import type { Config } from '../src/index.js';

/** 工具注册表在本文件用到的最小面。 */
interface ToolsFace {
  register(definition: unknown): () => void;
  get(name: string, scope?: ScopeKey): unknown;
}

/** 读工具注册表：测试体不是插件，用 `ctx.get` 绕过 inject 要求（读操作都显式带 scope）。 */
function toolsOf(ctx: Context): ToolsFace {
  return ctx.get('tools') as ToolsFace;
}

/** DSH 官方的装配方式：提示词服务 + 工具注册表。 */
async function makeRuntime(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  return ctx;
}

/**
 * 按 DSH 的方式挂载本插件：`inject` 必须一起带上，
 * 否则插件内部访问 `ctx.tools` 会被 cordis 直接拒绝。
 *
 * @returns 卸载句柄；卸载会走与「拨回开关」相同的 disposer 路径。
 */
async function mountPlugin(ctx: Context, config: Config): Promise<{ dispose(): unknown }> {
  return await ctx.plugin({ name: zhihu.name, inject: zhihu.inject, apply: zhihu.apply }, config);
}

/** 只靠名字参与可见性判定的最小工具。 */
function fixtureTool(name: string) {
  return defineTool({
    name,
    description: `${name} fixture`,
    parameters: {},
    output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'ok' }] },
    execute: async () => 'ok',
  });
}

/** 打开「隐藏原生网页工具」的配置。 */
function withSwitch(): Config {
  return ConfigSchema({ accessSecret: 'x', disableNativeWebSearch: true }) as Config;
}

/** 一个只提供 `list()` 的 agents 服务替身；对账逻辑只用到这一面。 */
function provideAgents(ctx: Context, agents: Array<{ id: string; ctx: Context }>): void {
  ctx.provide('agents', { list: () => agents });
}

/** 在给定 scope 里挂一个"tool-web"替身：注册若干原生工具名。 */
async function mountFakeToolWeb(ctx: Context, names: readonly string[]): Promise<void> {
  await ctx.plugin({
    name: 'fixture-tool-web',
    inject: ['tools'],
    apply(scopeCtx: Context) {
      for (const name of names) scopeCtx.tools.register(fixtureTool(name));
    },
  });
}

describe('隐藏原生网页工具（真实注册表）', () => {
  it('工具注册在 preset scope 时也能隐藏 —— web profile 的真实形态', async () => {
    const ctx = await makeRuntime();
    const presetKey: ScopeKey = { preset: 'standard' };
    const agentKey: ScopeKey = { agent: 'a1' };

    const preset = createScope(ctx, presetKey);
    await mountFakeToolWeb(preset.ctx, ['web_search', 'web_fetch']);
    const agent = createScope(ctx, agentKey, { parent: presetKey });

    // 前提：全局视图看不到它们，agent 视图看得到 —— 这正是 v1.3.0 误判的那一步。
    expect(toolsOf(ctx).get('web_search')).toBeUndefined();
    expect(toolsOf(ctx).get('web_search', agentKey)).toBeDefined();
    expect(toolsOf(ctx).get('web_fetch', agentKey)).toBeDefined();

    provideAgents(ctx, [{ id: 'a1', ctx: agent.ctx }]);
    await mountPlugin(ctx, withSwitch());

    expect(toolsOf(ctx).get('web_search', agentKey)).toBeUndefined();
    expect(toolsOf(ctx).get('web_fetch', agentKey)).toBeUndefined();
  });

  it('工具注册在全局层时：只对该 agent 隐藏，全局注册本身不动', async () => {
    const ctx = await makeRuntime();
    const agentKey: ScopeKey = { agent: 'a2' };
    toolsOf(ctx).register(fixtureTool('web_search'));
    const agent = createScope(ctx, agentKey);
    expect(toolsOf(ctx).get('web_search', agentKey)).toBeDefined();

    provideAgents(ctx, [{ id: 'a2', ctx: agent.ctx }]);
    await mountPlugin(ctx, withSwitch());

    expect(toolsOf(ctx).get('web_search', agentKey)).toBeUndefined();
    // restriction 是 per-scope 的：全局层与其他 scope 不受影响。
    expect(toolsOf(ctx).get('web_search')).toBeDefined();
  });

  it('工具完全不存在时不抛错（agent 创建守卫）', async () => {
    const ctx = await makeRuntime();
    const agentKey: ScopeKey = { agent: 'a3' };
    const agent = createScope(ctx, agentKey);
    provideAgents(ctx, [{ id: 'a3', ctx: agent.ctx }]);

    // 同步抛错会否决 agent 创建并回滚，所以「挂载成功」本身就是那条 blocker 断言。
    const fiber = await mountPlugin(ctx, withSwitch());
    expect(fiber).toBeDefined();
  });

  it('只存在其中一个原生工具时，只隐藏存在的那一个', async () => {
    const ctx = await makeRuntime();
    const agentKey: ScopeKey = { agent: 'a4' };
    toolsOf(ctx).register(fixtureTool('web_search')); // 没有 web_fetch
    const agent = createScope(ctx, agentKey);
    provideAgents(ctx, [{ id: 'a4', ctx: agent.ctx }]);

    await mountPlugin(ctx, withSwitch());

    expect(toolsOf(ctx).get('web_search', agentKey)).toBeUndefined();
    expect(toolsOf(ctx).get('web_fetch', agentKey)).toBeUndefined();
  });

  it('卸载后工具回到可见集（与「拨回开关」同一条 disposer 路径）', async () => {
    const ctx = await makeRuntime();
    const presetKey: ScopeKey = { preset: 'standard' };
    const agentKey: ScopeKey = { agent: 'a5' };
    const preset = createScope(ctx, presetKey);
    await mountFakeToolWeb(preset.ctx, ['web_search']);
    const agent = createScope(ctx, agentKey, { parent: presetKey });
    provideAgents(ctx, [{ id: 'a5', ctx: agent.ctx }]);

    const fiber = await mountPlugin(ctx, withSwitch());
    expect(toolsOf(ctx).get('web_search', agentKey)).toBeUndefined();

    await fiber.dispose();
    expect(toolsOf(ctx).get('web_search', agentKey)).toBeDefined();
  });

  it('agent scope 上的注册表必须用免 inject 的 get 取用', async () => {
    const ctx = await makeRuntime();
    const agentKey: ScopeKey = { agent: 'a6' };
    const agent = createScope(ctx, agentKey);

    // 真实约束：agent scope 的依赖面不由本插件决定，属性访问会抛
    // `cannot get property "tools" without inject`；免 inject 的 get 才拿得到。
    expect(() => agent.ctx.tools).toThrow(/without inject/);
    expect(agent.ctx.get('tools')).toBeDefined();
  });
});
