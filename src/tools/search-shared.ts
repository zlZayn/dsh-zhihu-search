/**
 * 两个搜索工具（站内 `zhihu_search` / 全网 `zhihu_global_search`）逐字共用的三件套。
 *
 * 为什么单独成模块：两者的实现骨架不可合并（`Filter` 语法互不兼容，见各文件头），
 * 但下面三处是**逐字重复**的 —— 而其中 `output.schema` 还必须**完全一致**
 * （宿主按它校验工具返回值，且由 test/tool.test.ts 断言两工具一致），
 * 各留一份就有漂移风险。
 */

import type { ObjectValueSchemaSpec } from '@deepseek-ai/dsh-tools';
import { assertKnownParams, CompileError } from '../utils/compiler.js';
import { mapError } from '../utils/errors.js';
import { LocalRateLimitError } from '../state.js';
import { sanitizeSnippet, stripTrackingParams } from '../utils/text.js';
import type { SearchOutput, ZhihuSearchData, ZhihuSearchItem } from '../types.js';
import { cacheKeyFor, type ToolDeps } from './deps.js';

/** 两工具共用的 `output.schema`。宿主按它校验返回值（`additionalProperties: false`）。 */
export const SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    query: { type: 'string', required: true },
    items: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          url: { type: 'string', required: true },
          snippet: { type: 'string', required: true },
          author: { type: 'string', required: true },
          voteUpCount: { type: 'number' },
          // ⚠ 可选字段也必须在这里声明：output.schema 是 additionalProperties: false，
          // **宿主按它校验工具返回值** —— 投影了却没声明 = 整个调用被判非法
          // （v1.4.0 就是这样让所有搜索调用失败的，回归守卫见 test/tool.test.ts）。
          commentCount: { type: 'number' },
          editTime: { type: 'number' },
          contentType: { type: 'string', required: true },
        },
      },
    },
    hasMore: { type: 'boolean', required: true },
    error: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true },
        message: { type: 'string', required: true },
        hint: { type: 'string' },
      },
    },
  },
} satisfies ObjectValueSchemaSpec;

/** 条数解析的端点参数：两工具的默认条数与上限各自不同（值取自传输层契约常量，此处不抄）。 */
export interface CountLimits {
  /** 端点 `Count` 上限（来自传输层契约常量）。 */
  max: number;
  /** 未指定条数时的默认值。 */
  fallback: number;
}

/**
 * 模型**原始**请求的条数：只取下界与整数，**不按端点上限夹取**。
 *
 * 渲染层要用它判断「是不是请求得比端点允许的还多」—— 传夹取后的值会让
 * `requestedCount > maxCount` 恒为假，到顶提示变成永不触发的死代码（v1.5.1 的回归）。
 *
 * @param raw - 模型给的条数，未指定时用 `limits.fallback`。
 * @param fallback - 未指定条数时的默认值（各工具不同）。
 * @returns 不小于 1 的整数（可能大于端点上限）。
 */
export function rawRequestedCount(raw: number | undefined, fallback: number): number {
  return Math.max(1, Math.trunc(raw ?? fallback));
}

/**
 * 实际请求用的条数：在原始请求值之上再按端点上限夹取。
 *
 * @param raw - 模型给的条数。
 * @param limits - 该工具的默认条数与端点上限。
 * @returns 落在 1..{@link CountLimits.max} 的整数。
 */
export function resolveRequestedCount(raw: number | undefined, limits: CountLimits): number {
  return Math.min(rawRequestedCount(raw, limits.fallback), limits.max);
}

/**
 * 把一条原始结果投影为 Canonical Output 条目。
 *
 * 为什么返回 `undefined` 而不是带空 URL 的条目：
 * 没有链接的结果无法被引用，占着上下文却没用。
 *
 * @param item - 知乎原始条目。
 * @returns 投影结果；缺少 URL 时返回 `undefined`。
 */
export function projectItem(item: ZhihuSearchItem): SearchOutput['items'][number] | undefined {
  const url = stripTrackingParams(typeof item.Url === 'string' ? item.Url : '');
  if (url === '') return undefined;

  return {
    title: sanitizeSnippet(typeof item.Title === 'string' ? item.Title : '', 200) || '(无标题)',
    url,
    snippet: sanitizeSnippet(typeof item.ContentText === 'string' ? item.ContentText : ''),
    author: sanitizeSnippet(typeof item.AuthorName === 'string' ? item.AuthorName : '', 60),
    // 上游没报点赞数时整个键省略，不兜底成 0 —— 写 0 等于告诉模型「没人赞」。
    // 注意实测结论：上游**从未省略**该字段，外站网页也有这个键、值是占位的 0。
    // 省略分支是防伪造的兜底；外站那个 0 由渲染层决定不展示（present/search.ts）。
    ...(typeof item.VoteUpCount === 'number' && Number.isFinite(item.VoteUpCount) ? { voteUpCount: item.VoteUpCount } : {}),
    // 投影规则同上：上游没报就省略，绝不兜底成 0（外站那个 0 是占位值，由渲染层决定不展示）。
    ...(typeof item.CommentCount === 'number' && Number.isFinite(item.CommentCount) ? { commentCount: item.CommentCount } : {}),
    ...(typeof item.EditTime === 'number' && Number.isFinite(item.EditTime) ? { editTime: item.EditTime } : {}),
    // ContentType 缺失时留空，不编造标签：实测站内与网页链接的平台各自返回**空串**（字段在、值为空），
    // 兜底成 'Answer'（站内）或 'Article'（全网）都会让模型把陌生网页当成知乎内容。
    contentType: typeof item.ContentType === 'string' ? item.ContentType : '',
  };
}

/** 一次搜索调用的差异部分：编译出的请求参数、上游调用与返回变换。 */
export interface SearchExecutionPlan {
  /** 计入缓存键的参数（**必须**是归一化后的值；站内还必须是候选池大小）。 */
  cacheArgs: unknown;
  /** 调上游（差异点：`searchZhihu` / `searchGlobal`）。 */
  fetch: (signal: AbortSignal | undefined) => Promise<ZhihuSearchData>;
  /** 返回变换：站内按本次条数截断、全网原样。缓存命中与缓存写入**两条**返回路径共用，别只改一处。 */
  onReturn: (value: SearchOutput) => SearchOutput;
}

/**
 * 搜索类工具的共享执行骨架。
 *
 * **顺序是契约，别改**：白名单 → 空查询 → 缓存（优先于限流：命中不该消耗令牌与额度）
 * → 限流 → 上游 → 投影 → 缓存写（写**完整池子**）→ 返回（在返回路径上截断）。
 * 差异全部经 `plan` 注入；「`execute` 绝不 throw」的契约也收在这里（唯一 try/catch），
 * 任何失败都变成结构化 Canonical Output。
 */
export async function executeSearch(options: {
  deps: ToolDeps;
  /** 模型给的原始参数（含 query 与各工具自己的旋钮）。 */
  args: { query: string };
  /** 该工具的未知参数白名单。 */
  paramNames: readonly string[];
  /** 工具名，用于隔离缓存空间。 */
  toolName: string;
  /** 归一化 + 编译出的差异部分（可能抛 `CompileError`，由本函数的 catch 转结构化错误）。 */
  plan: (query: string) => SearchExecutionPlan;
  signal: AbortSignal | undefined;
}): Promise<SearchOutput> {
  const { deps, args, paramNames, toolName, plan, signal } = options;
  const query = args.query.trim();

  try {
    assertKnownParams(args, paramNames);
    if (query === '') throw new CompileError('搜索关键词不能为空。');

    const { cacheArgs, fetch, onReturn } = plan(query);
    const key = cacheKeyFor(deps, toolName, cacheArgs);

    // 缓存优先于限流：命中缓存不该消耗任何令牌，也不该消耗知乎额度。
    const cached = deps.cache.get(key);
    if (cached !== undefined) return onReturn(cached as SearchOutput);

    if (!deps.searchBucket.tryConsume()) {
      throw new LocalRateLimitError(
        `本地频率限制：搜索类请求超过每分钟上限。`,
        deps.searchBucket.retryAfterMs(),
      );
    }

    const data = await fetch(signal);

    const items: SearchOutput['items'] = [];
    for (const raw of data.Items ?? []) {
      const projected = projectItem(raw);
      if (projected !== undefined) items.push(projected);
    }

    const value: SearchOutput = { ok: true, query, items, hasMore: data.HasMore };
    // 缓存完整池子，返回按本次条数截断 —— 顺序不可颠倒（站内的 onReturn 负责截断）。
    deps.cache.set(key, value);
    return onReturn(value);
  } catch (error) {
    // 契约：execute 绝不 throw。任何失败都要变成结构化 Canonical Output。
    return { ok: false, query, items: [], hasMore: false, error: mapError(error) };
  }
}
