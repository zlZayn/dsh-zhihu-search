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
import { compileFilter, compileSortBy, SORT_FIELDS } from '../utils/compiler.js';
import { presentSearchCall, presentSearchResult, renderSearch, searchMetaFromValue } from '../present/search.js';
import type { SearchOutput } from '../types.js';
import { ZHIHU_SEARCH_MAX_COUNT } from '../transport.js';
import { executeSearch, rawRequestedCount, resolveRequestedCount, SEARCH_OUTPUT_SCHEMA } from './search-shared.js';
import type { ToolDeps } from './deps.js';

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
/**
 * 参数白名单。
 *
 * 为什么要有它：DSH 的参数 schema 是**开放**的（值 schema DSL 不接受
 * `additionalProperties: false`），未知键会被静默丢弃 —— 模型传 `page=2`
 * 会拿到第一页却以为翻页成功。校验放本地，schema 里不加散文。
 * 与参数定义的一致性由 `test/tool.test.ts` 断言守着，避免两处漂移。
 */
const PARAM_NAMES = ['query', 'count', 'sortField', 'order', 'minValue', 'publishedAfter', 'publishedBefore'] as const;

/** 协作式超时预算；超时必须早于 DSH 的外层截断，才能返回结构化错误。 */
const TIMEOUT_MS = 15_000;


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
      schema: SEARCH_OUTPUT_SCHEMA,
      render: (args, value) =>
        renderSearch(value, {
          // 必须传**原始**请求值：传夹取后的值会让到顶提示永远不触发。
          requestedCount: rawRequestedCount(args.count, DEFAULT_COUNT),
          minValue: args.minValue,
          maxCount: MAX_COUNT,
          filtered:
            args.minValue !== undefined || args.publishedAfter !== undefined || args.publishedBefore !== undefined,
          scope: 'zhihu',
        }),
      presentationMeta: (_args, value) => searchMetaFromValue(value),
    },

    timeoutMs: TIMEOUT_MS,
    // 只读且无父级状态，可以与其他调用并行。
    isConcurrencySafe: () => true,
    presentCall: (args) => presentSearchCall(args),
    presentResult: (args, result) => presentSearchResult(args, result),

    async execute(args, exec) {
      return executeSearch({
        deps,
        args,
        paramNames: PARAM_NAMES,
        toolName: ZHIHU_SEARCH_TOOL,
        signal: exec.signal,
        plan: (query) => {
          const requestedCount = resolveRequestedCount(args.count, { max: MAX_COUNT, fallback: DEFAULT_COUNT });
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
          return {
            cacheArgs: { query, count: poolCount, sortBy, filter },
            fetch: (signal) =>
              deps.client.searchZhihu(
                { query, count: poolCount, ...(sortBy === undefined ? {} : { sortBy }), ...(filter === undefined ? {} : { filter }) },
                signal,
              ),
            // 缓存完整池子，返回按本次条数截断 —— 顺序不可颠倒。
            onReturn: (value) => sliceItems(value, requestedCount),
          };
        },
      });
    },
  });
}
