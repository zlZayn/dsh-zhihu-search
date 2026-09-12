/**
 * 搜索类工具的呈现层 —— 全部是纯函数。
 *
 * ⚠ 本模块**没有任何运行时依赖**（DSH 类型全部 `import type`，编译期即擦除）。
 * 这是刻意的：纯函数才能被单元测试直接调用，而「presentationMeta 是纯的」
 * 是红线要求，必须可验证而不是靠声明。
 *
 * 三层职责严格分离（红线 2）：
 * - {@link renderSearch}      → 只产模型可见的 Markdown，**永不**包含 UI 字段
 * - {@link searchMetaFromValue} → 只产可持久化的结构化数据，供历史回放
 * - {@link presentSearchResult} → 只产 UI 卡片，**永不**进入模型上下文
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { GenericCallView, ToolResult, WebSearchResultView, WebSource } from '@deepseek-ai/dsh-tools';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { SearchOutput } from '../types.js';

/** 搜索结果持久化的呈现元数据。 */
export interface SearchMeta {
  /** 结构化来源。Markdown 无法无损承载它们，所以必须走 meta。 */
  readonly sources: WebSource[];
  /** 是否还有更多结果未展示。 */
  readonly truncated: boolean;
}

/**
 * 转义用于 Markdown 链接标题的文本。
 *
 * 知乎标题里出现 `]` 或换行是常态（例如 `Python 爬虫[入门]`），
 * 不转义会把 `### [标题](url)` 撕成非法 Markdown，模型读到的结构就错位了。
 */
function escapeLinkText(input: string): string {
  return input.replace(/[\r\n]+/g, ' ').replace(/([\[\]])/g, '\\$1').trim();
}

/**
 * 渲染模型可见的 Markdown。
 *
 * 严禁在此拼接任何 UI 字段：该文本是模型上下文的唯一来源，
 * 混入 `card`/`sources` 之类的结构既浪费 token 又会误导模型。
 *
 * @param value - 工具的 Canonical Output。
 * @returns 单个文本块。
 */
export function renderSearch(value: SearchOutput): ContentBlock[] {
  if (!value.ok) {
    const lines = [`❌ 搜索失败：${value.error?.message ?? '未知错误'}`];
    if (value.error?.hint !== undefined && value.error.hint !== '') lines.push(value.error.hint);
    return [{ type: 'text', text: lines.join('\n') }];
  }

  if (value.items.length === 0) {
    return [{ type: 'text', text: `未找到关于 "${value.query}" 的知乎内容。` }];
  }

  const lines: string[] = [`找到 ${String(value.items.length)} 条关于 "${value.query}" 的知乎结果：`, ''];
  for (const item of value.items) {
    lines.push(`### [${escapeLinkText(item.title)}](${item.url})`);
    lines.push(`**作者**: ${item.author || '匿名'} | **点赞**: ${String(item.voteUpCount)} | **类型**: ${item.contentType}`);
    lines.push(`> ${item.snippet}`);
    lines.push('');
  }
  return [{ type: 'text', text: lines.join('\n') }];
}

/**
 * 从 Canonical Output 投影出可持久化的呈现元数据。
 *
 * 红线 3：本函数**只读 `value`**。不得读取 `Date.now()`、环境变量、缓存或网络。
 * 理由：meta 会被写进会话日志，历史回放时会重新喂给 `presentResult`；
 * 一旦掺入时间或随机量，回放出的卡片就与当初不一致。
 *
 * @param value - 工具的 Canonical Output。
 * @returns 纯数据投影。
 */
export function searchMetaFromValue(value: SearchOutput): JsonValue {
  return {
    sources: value.items.map((item) => ({ url: item.url, title: item.title, snippet: item.snippet })),
    truncated: value.hasMore,
  };
}

/**
 * 把不透明的 meta 收窄为 {@link SearchMeta}。
 *
 * 容错优先：会话日志可能来自旧版本插件，字段形状未必匹配。
 * 形状不对时返回 `undefined` 让 UI 退回原始文本，而不是在回放时抛错。
 *
 * @param meta - `result.meta`，类型为不透明 JSON。
 * @returns 收窄后的元数据，或 `undefined`。
 */
export function searchMetaFromResult(meta: unknown): SearchMeta | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined;
  const record = meta as { sources?: unknown; truncated?: unknown };
  if (!Array.isArray(record.sources)) return undefined;

  const sources: WebSource[] = [];
  for (const raw of record.sources) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as { url?: unknown; title?: unknown; snippet?: unknown };
    if (typeof item.url !== 'string') continue;
    sources.push({
      url: item.url,
      ...(typeof item.title === 'string' ? { title: item.title } : {}),
      ...(typeof item.snippet === 'string' ? { snippet: item.snippet } : {}),
    });
  }
  return { sources, truncated: record.truncated === true };
}

/**
 * 待执行态的卡片：给模型一次搜索时显示查询词。
 *
 * @param args - 已校验的工具参数。
 * @returns 通用卡片，分类为 search。
 */
export function presentSearchCall(args: { readonly query: string }): GenericCallView {
  return { card: 'generic', title: `知乎搜索：${args.query}`, kind: 'search' };
}

/**
 * 完成态卡片：结构化来源列表。
 *
 * 为什么失败时返回 `undefined` 而不是自己造一张错误卡：
 * `render` 产出的错误文本已经是准确的，UI 的降级路径会原样显示它。
 * 再拼一张卡只是把同一句话写两遍，还会在两者措辞漂移时产生矛盾。
 *
 * @param args - 已校验的工具参数，用于补一个窗口截断后仍可读的标题。
 * @param result - 模型可见的最终结果。
 * @returns web 搜索卡片，或 `undefined` 交回 UI 降级。
 */
export function presentSearchResult(
  args: { readonly query: string },
  result: ToolResult,
): WebSearchResultView | undefined {
  if (result.isError) return undefined;
  const meta = searchMetaFromResult(result.meta);
  if (meta === undefined) return undefined;

  // 注意：WebSource 契约里**没有**来源字段，卡片标题才是表达「来自知乎」的位置。
  return {
    card: 'web',
    kind: 'search',
    title: `知乎搜索：${args.query}`,
    sources: meta.sources,
    truncated: meta.truncated,
  };
}
