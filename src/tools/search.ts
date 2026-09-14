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
import { ZHIHU_SEARCH_MAX_COUNT } from '../transport.js';
import { cacheKeyFor, type ToolDeps } from './deps.js';

/** 工具名。 */
export const ZHIHU_SEARCH_TOOL = 'zhihu_search';

/**
 * 站内搜索的 `Count` 上限（实测：超出由服务端截断）。
 *
 * 单一来源是传输层的端点契约常量（它同时负责发请求前夹取），这里只是别名 ——
 * 同一个上游事实在两层各写一个数字，改一处漏一处就会让描述与实际行为不一致。
 */
const MAX_COUNT = ZHIHU_SEARCH_MAX_COUNT;
/** 未指定时使用的条数。 */
const DEFAULT_COUNT = 5;

/**
 * 带下限筛选时使用的候选池大小。
 *
 * 为什么必须取**端点上限**而不是模型要的条数：知乎的 `SortBy` 区间只筛
 * 「本次检索到的候选」（实测：同查询同下限，`count=3/5/10` 分别得到 1/1/3 条，
 * 且结果恒为前 `count` 条的子集）。要的条数越少、候选越少，筛选就越容易把结果
 * 筛空 —— 那是「知乎没有高赞内容」这类错误结论的来源。
 * 取满上限后仍按模型要的条数截断，因此契约不变，只是不再白白丢掉候选。
 */
const FILTERED_CANDIDATE_COUNT = MAX_COUNT;

/**
 * 归一化模型请求的条数。
 *
 * `execute` 与 `render` 共用一份夹取逻辑：渲染层要用同一个数字判断
 * 「结果是不是被下限筛少了」，两处各夹一次迟早会漂移。
 *
 * @param raw - 模型给的条数，未指定时用 {@link DEFAULT_COUNT}。
 * @returns 落在 1..{@link MAX_COUNT} 的整数。
 */
function resolveRequestedCount(raw: number | undefined): number {
  return Math.max(1, Math.min(Math.trunc(raw ?? DEFAULT_COUNT), MAX_COUNT));
}

/**
 * 按本次请求的条数截断候选池的筛选结果。
 *
 * 缓存里存的必须是**完整候选池的筛选结果**：截断只发生在返回路径上，
 * 否则 `count=3` 的调用会把 `count=10` 的缓存污染成 3 条。
 *
 * @param value - 候选池的筛选结果。
 * @param requestedCount - 本次请求的条数。
 * @returns 条目数不超过 `requestedCount` 的结果。
 */
function sliceItems(value: SearchOutput, requestedCount: number): SearchOutput {
  return value.items.length <= requestedCount ? value : { ...value, items: value.items.slice(0, requestedCount) };
}
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
    // 投影规则同上：上游没报就省略，绝不兜底成 0。
    ...(typeof item.CommentCount === 'number' && Number.isFinite(item.CommentCount) ? { commentCount: item.CommentCount } : {}),
    ...(typeof item.EditTime === 'number' && Number.isFinite(item.EditTime) ? { editTime: item.EditTime } : {}),
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
      '知乎站内搜索：检索知乎的问答与文章，可按点赞数、评论数或时间排序，也能按发布时间限定范围。' +
      '适合中文经验、产品评测、行业讨论、技术实践。' +
      '要搜知乎站外某个网站上的资料改用 zhihu_global_search；要一段成体系的解释而不是来源列表改用 zhihu_zhida。' +
      // 结果形态槽必须「剧透」：函数调用模式下宿主只发 name/description/parameters，
      // output.schema 不进上下文，模型在首次调用前无从知道拿得到什么、拿不到什么。
      '结果含标题、链接、摘要、作者、点赞数、评论数与时间，不含图片；没有翻页参数。',

    // 语义化参数：模型永远不会看到 SortBy / Filter 的字符串语法。
    parameters: {
      query: { type: 'string', required: true, description: '搜索关键词，中文效果最好。' },
      count: { type: 'integer', description: `返回条数，1–${String(MAX_COUNT)}，默认 ${String(DEFAULT_COUNT)}。`, default: DEFAULT_COUNT },
      sortField: {
        type: 'string',
        enum: SORT_FIELDS,
        description: '排序字段。default 沿用知乎相关性排序；voteUpCount 点赞数 · commentCount 评论数 · editTime 时间（发布或最后编辑，由上游决定）。',
        default: 'default',
      },
      // 参数耦合只能写在描述里：DSH 的值 schema DSL 拒绝 dependentRequired / minimum / maximum
      // （实测报 "not supported by the value schema DSL"），因此用 [依赖 X] 前缀标注，
      // 真正的拦截在 execute 本地完成（CompileError，不发请求）。
      order: {
        type: 'string',
        enum: ['desc', 'asc'],
        description: '[依赖 sortField] 排序方向，默认 desc（降序）。不给 sortField 时只接受默认值 desc。',
        default: 'desc',
      },
      minValue: {
        type: 'number',
        description:
          '[依赖 sortField] 排序字段的下限（含）。它只筛本次检索到的候选，不是全库过滤：达标项不足时返回条数会少于 count —— 放宽下限或换关键词，不要据此断定知乎没有高赞内容。',
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
      },
      render: (args, value) =>
        renderSearch(value, { requestedCount: resolveRequestedCount(args.count), minValue: args.minValue }),
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

        const requestedCount = resolveRequestedCount(args.count);
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

        // 有下限时把候选池取满（理由见 FILTERED_CANDIDATE_COUNT）。
        const poolCount = minValue === undefined ? requestedCount : Math.max(requestedCount, FILTERED_CANDIDATE_COUNT);

        // 缓存键必须用**归一化后**的参数，且必须用候选池大小：
        // 否则 count=3 与 count=10 会各占一个键，却发出两个内容相同的请求。
        const key = cacheKeyFor(deps, ZHIHU_SEARCH_TOOL, { query, count: poolCount, sortBy, filter });

        // 缓存优先于限流：命中缓存不该消耗任何令牌，也不该消耗知乎额度。
        const cached = deps.cache.get(key);
        if (cached !== undefined) return sliceItems(cached as SearchOutput, requestedCount);

        if (!deps.searchBucket.tryConsume()) {
          throw new LocalRateLimitError(
            `本地频率限制：搜索类请求超过每分钟上限。`,
            deps.searchBucket.retryAfterMs(),
          );
        }

        const data = await deps.client.searchZhihu(
          { query, count: poolCount, ...(sortBy === undefined ? {} : { sortBy }), ...(filter === undefined ? {} : { filter }) },
          exec.signal,
        );

        const items: SearchOutput['items'] = [];
        for (const raw of data.Items ?? []) {
          const projected = projectItem(raw);
          if (projected !== undefined) items.push(projected);
        }

        const value: SearchOutput = { ok: true, query, items, hasMore: data.HasMore };
        // 缓存完整池子，返回按本次条数截断 —— 顺序不可颠倒。
        deps.cache.set(key, value);
        return sliceItems(value, requestedCount);
      } catch (error) {
        // 契约：execute 绝不 throw。任何失败都要变成结构化 Canonical Output。
        return { ok: false, query, items: [], hasMore: false, error: mapError(error) };
      }
    },
  });
}
