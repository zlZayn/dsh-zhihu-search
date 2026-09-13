/**
 * `zhihu_search` —— 知乎站内搜索工具。
 *
 * ⚠ 端点的硬约束（全部来自生产实测，不是文档推断）：
 * - 只有 `Query`/`Count`/`SortBy`/`Filter` 四个参数；`Count` 上限 10
 * - `Filter` **只认 `publish_time`**；传 `host` 得到 `10001 invalid Filter expression`
 * - `HasMore` **恒为 false**，不可当作翻页依据
 *
 * 模型只看到语义化参数；`SortBy`/`Filter` 字符串由编译器生成（红线 5）。
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { CompileError, compileFilter, compileSortBy, SORT_FIELDS } from '../utils/compiler.js';
import { mapError } from '../utils/errors.js';
import { sanitizeSnippet, stripTrackingParams } from '../utils/text.js';
import { LocalRateLimitError } from '../state.js';
import { presentSearchCall, presentSearchResult, renderSearch, searchMetaFromValue } from '../present/search.js';
import type { SearchOutput, ZhihuSearchItem } from '../types.js';
import { cacheKeyFor, type ToolDeps } from './deps.js';

/** 工具名。 */
export const ZHIHU_SEARCH_TOOL = 'zhihu_search';

/** 站内搜索的 `Count` 上限（实测：超出由服务端截断）。 */
const MAX_COUNT = 10;
/** 未指定时使用的条数。 */
const DEFAULT_COUNT = 5;
/** 协作式超时预算；超时必须早于 DSH 的外层截断，才能返回结构化错误。 */
const TIMEOUT_MS = 15_000;

/**
 * 把一条原始结果投影为 Canonical Output 条目。
 *
 * 为什么返回 `undefined` 而不是带空 URL 的条目：
 * 没有链接的结果无法被引用，占着上下文却没用。
 *
 * @param item - 知乎原始条目。
 * @returns 投影结果；缺少 URL 时返回 `undefined`。
 */
function projectItem(item: ZhihuSearchItem): SearchOutput['items'][number] | undefined {
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
    // ContentType 缺失时留空，不编造标签：实测外站网页的类型是**空串**（字段在、值为空），
    // 兜底成 'Answer' 会让模型把一个陌生网页当成知乎回答。
    contentType: typeof item.ContentType === 'string' ? item.ContentType : '',
  };
}

/**
 * 构造 `zhihu_search` 工具。
 *
 * @param deps - 运行期依赖（客户端、缓存、限流桶）。
 * @returns 可直接交给 `ctx.tools.register()` 的工具定义。
 */
export function createZhihuSearchTool(deps: ToolDeps): ToolDefinition {
  return defineTool({
    name: ZHIHU_SEARCH_TOOL,
    description:
      '知乎站内搜索：检索知乎的问答与文章，可筛出高赞、多评论或近期更新的内容，也支持限定发布时间。' +
      '适合中文经验、产品评测、行业讨论、技术实践。' +
      '要搜知乎站外某个网站上的资料改用 zhihu_global_search；要一段成体系的解释而不是来源列表改用 zhihu_zhida。' +
      '只返回文字摘要与原始链接，结果不含图片。',

    // 语义化参数：模型永远不会看到 SortBy / Filter 的字符串语法。
    parameters: {
      query: { type: 'string', required: true, description: '搜索关键词，中文效果最好。' },
      count: { type: 'integer', description: `返回条数，1–${String(MAX_COUNT)}，默认 ${String(DEFAULT_COUNT)}。`, default: DEFAULT_COUNT },
      sortField: {
        type: 'string',
        enum: SORT_FIELDS,
        description: '排序字段。default 表示沿用知乎相关性排序；其余按该指标排序。',
        default: 'default',
      },
      order: {
        type: 'string',
        enum: ['desc', 'asc'],
        description: '排序方向，默认 desc（降序）。仅在指定了 sortField 时生效。',
        default: 'desc',
      },
      minValue: {
        type: 'number',
        description: '排序字段的下限（含），必须配合 sortField 使用。例如 sortField=voteUpCount 且 minValue=100 表示只要点赞数 ≥ 100 的结果。',
      },
      publishedAfter: { type: 'string', description: '只要该日期之后发布的内容，格式 YYYY-MM-DD。' },
      publishedBefore: { type: 'string', description: '只要该日期之前发布的内容，格式 YYYY-MM-DD。' },
    },

    output: {
      schema: {
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
      },
      render: (_args, value) => renderSearch(value),
      presentationMeta: (_args, value) => searchMetaFromValue(value),
    },

    timeoutMs: TIMEOUT_MS,
    // 只读且无父级状态，可以与其他调用并行。
    isConcurrencySafe: () => true,
    presentCall: (args) => presentSearchCall(args),
    presentResult: (args, result) => presentSearchResult(args, result),

    async execute(args, exec) {
      const query = args.query.trim();

      try {
        if (query === '') throw new CompileError('搜索关键词不能为空。');

        const rawCount = args.count ?? DEFAULT_COUNT;
        const count = Math.max(1, Math.min(Math.trunc(rawCount), MAX_COUNT));
        const sortField = args.sortField ?? 'default';
        const order = args.order ?? 'desc';
        const minValue = args.minValue;

        const sortBy = compileSortBy({
          sortField,
          order,
          ...(minValue === undefined ? {} : { minValue }),
        });
        // 站内搜索作用域：只允许 publish_time，site 会被编译器拒绝。
        const filter = compileFilter(
          {
            ...(args.publishedAfter === undefined ? {} : { publishedAfter: args.publishedAfter }),
            ...(args.publishedBefore === undefined ? {} : { publishedBefore: args.publishedBefore }),
          },
          'zhihu',
        );

        // 缓存键必须用**归一化后**的参数：否则 count=99 与 count=10 会各占一个键。
        const key = cacheKeyFor(deps, ZHIHU_SEARCH_TOOL, { query, count, sortBy, filter });

        // 缓存优先于限流：命中缓存不该消耗任何令牌，也不该消耗知乎额度。
        const cached = deps.cache.get(key);
        if (cached !== undefined) return cached as SearchOutput;

        if (!deps.searchBucket.tryConsume()) {
          throw new LocalRateLimitError(
            `本地频率限制：搜索类请求超过每分钟上限。`,
            deps.searchBucket.retryAfterMs(),
          );
        }

        const data = await deps.client.searchZhihu(
          { query, count, ...(sortBy === undefined ? {} : { sortBy }), ...(filter === undefined ? {} : { filter }) },
          exec.signal,
        );

        const items: SearchOutput['items'] = [];
        for (const raw of data.Items ?? []) {
          const projected = projectItem(raw);
          if (projected !== undefined) items.push(projected);
        }

        const value: SearchOutput = { ok: true, query, items, hasMore: data.HasMore };
        deps.cache.set(key, value);
        return value;
      } catch (error) {
        // 契约：execute 绝不 throw。任何失败都要变成结构化 Canonical Output。
        return { ok: false, query, items: [], hasMore: false, error: mapError(error) };
      }
    },
  });
}
