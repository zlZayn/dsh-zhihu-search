/**
 * `zhihu_global_search` —— 知乎全网搜索工具。
 *
 * 为什么它必须与站内搜索分成两个工具，而不是一个工具的开关：
 * 两者的 `Filter` 语法**互不兼容** —— 站内只认 `publish_time`，
 * 全网才认 `host`。合成一个工具意味着模型要记住「哪个参数在哪个模式下非法」，
 * 那是必然出错的负担。拆开后每个工具的参数集合都是自洽的。
 *
 * 实测补充：`SortBy` 在本端点**疑似被忽略**（返回顺序不随排序字段变化），
 * 因此刻意不暴露 `sortField`，避免给模型一个看起来有用但无效的旋钮。
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { CompileError, compileFilter } from '../utils/compiler.js';
import { mapError } from '../utils/errors.js';
import { sanitizeSnippet, stripTrackingParams } from '../utils/text.js';
import { LocalRateLimitError } from '../state.js';
import { presentSearchCall, presentSearchResult, renderSearch, searchMetaFromValue } from '../present/search.js';
import type { SearchOutput, ZhihuSearchItem } from '../types.js';
import { cacheKeyFor, type ToolDeps } from './deps.js';

/** 工具名。 */
export const ZHIHU_GLOBAL_SEARCH_TOOL = 'zhihu_global_search';

/** 全网搜索的 `Count` 上限（实测：比站内搜索宽，可达 20）。 */
const MAX_COUNT = 20;
/** 未指定时使用的条数。 */
const DEFAULT_COUNT = 8;
/** 协作式超时预算。 */
const TIMEOUT_MS = 20_000;

/**
 * 把一条原始结果投影为 Canonical Output 条目。
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
    // ContentType 缺失时留空，不编造标签：实测第三方网页（如接单平台）的类型是**空串**
    // （字段在、值为空），兜底成 'Article' 会让模型把广告页当成知乎文章。
    contentType: typeof item.ContentType === 'string' ? item.ContentType : '',
  };
}

/**
 * 构造 `zhihu_global_search` 工具。
 *
 * @param deps - 运行期依赖。
 * @returns 可直接注册的工具定义。
 */
export function createZhihuGlobalSearchTool(deps: ToolDeps): ToolDefinition {
  return defineTool({
    name: ZHIHU_GLOBAL_SEARCH_TOOL,
    description:
      '知乎全网索引搜索：检索知乎索引收录的公开网页，结果里会混入部分知乎站内内容。' +
      '适合按站点域名或发布时间找资料；要专搜知乎的问答和文章、且要更贴题的排序，用 zhihu_search。' +
      `单次最多 ${String(MAX_COUNT)} 条且没有翻页参数；域名过滤不接受知乎域名。`,

    parameters: {
      query: { type: 'string', required: true, description: '搜索关键词。' },
      count: { type: 'integer', description: `返回条数，1–${String(MAX_COUNT)}，默认 ${String(DEFAULT_COUNT)}。`, default: DEFAULT_COUNT },
      site: { type: 'string', description: '只搜索该域名，例如 github.com；传完整 URL 也会被自动剥成域名。不支持知乎域名。' },
      publishedAfter: { type: 'string', description: '只要该日期之后发布的内容，格式 YYYY-MM-DD。' },
      publishedBefore: { type: 'string', description: '只要该日期之前发布的内容，格式 YYYY-MM-DD。' },
      searchDb: { type: 'string', enum: ['all', 'realtime', 'static'], description: '索引库，默认 all。realtime 偏最新，static 偏长期收录。', default: 'all' },
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
    isConcurrencySafe: () => true,
    presentCall: (args) => presentSearchCall(args),
    presentResult: (args, result) => presentSearchResult(args, result),

    async execute(args, exec) {
      const query = args.query.trim();

      try {
        if (query === '') throw new CompileError('搜索关键词不能为空。');

        const rawCount = args.count ?? DEFAULT_COUNT;
        const count = Math.max(1, Math.min(Math.trunc(rawCount), MAX_COUNT));

        // 全网作用域：允许 host；编译器会拦下知乎域名并给出「请用站内搜索」的提示。
        const filter = compileFilter(
          {
            ...(args.site === undefined ? {} : { site: args.site }),
            ...(args.publishedAfter === undefined ? {} : { publishedAfter: args.publishedAfter }),
            ...(args.publishedBefore === undefined ? {} : { publishedBefore: args.publishedBefore }),
          },
          'global',
        );

        const searchDb = args.searchDb ?? 'all';
        const key = cacheKeyFor(deps, ZHIHU_GLOBAL_SEARCH_TOOL, { query, count, filter, searchDb });

        const cached = deps.cache.get(key);
        if (cached !== undefined) return cached as SearchOutput;

        if (!deps.searchBucket.tryConsume()) {
          throw new LocalRateLimitError(
            `本地频率限制：搜索类请求超过每分钟上限。`,
            deps.searchBucket.retryAfterMs(),
          );
        }

        const data = await deps.client.searchGlobal(
          {
            query,
            count,
            ...(filter === undefined ? {} : { filter }),
            ...(searchDb === 'all' ? {} : { searchDb }),
          },
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
        return { ok: false, query, items: [], hasMore: false, error: mapError(error) };
      }
    },
  });
}
