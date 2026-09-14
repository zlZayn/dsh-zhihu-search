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

/**
 * 渲染模型可见文本时需要的调用上下文。
 *
 * 为什么参数要传进来：`minValue` 是「候选内筛选」而不是全库排序
 * （见 [tools/search.ts](../tools/search.ts) 的 `FILTERED_CANDIDATE_COUNT`），
 * 只有渲染层知道「这次带了下限」，才说得清「筛少了」与「知乎没有」的区别。
 */
export interface SearchRenderContext {
  /** 本次请求的条数；用于判断结果是不是被下限筛少了、或被单次上限截断了。 */
  readonly requestedCount?: number;
  /** 生效的排序下限；有值即说明这次是候选内筛选。 */
  readonly minValue?: number;
  /** 本工具的端点上限（站内 10 / 全网 20）；用来把「被上限截断」与「筛掉了」分开说。 */
  readonly maxCount?: number;
  /** 本次是否带了筛选条件（下限 / 时间窗 / 域名 / 索引库）；决定空态首句的措辞。 */
  readonly filtered?: boolean;
  /** 结果来源：站内工具的结果全是知乎内容；全网工具会混入外站页面。 */
  readonly scope?: 'zhihu' | 'global';
}

/**
 * 生成头部文案：来源构成不同，措辞就不同。
 *
 * 全网搜索会混入外站页面（实测一次查询 10 条里只有 1 条来自知乎），
 * 笼统写「知乎结果」会让模型把 github 的条目也当成知乎内容引用。
 *
 * @param value - 成功的搜索结果。
 * @param context - 调用上下文；`scope` 决定是否区分来源。
 * @returns 头部一句（不含末尾冒号）。
 */
function headerFor(value: SearchOutput, context: SearchRenderContext): string {
  const total = value.items.length;
  const base = `找到 ${String(total)} 条关于 "${value.query}"`;
  if (context.scope !== 'global') return `${base} 的知乎结果`;
  // 空串 ContentType 即外站页面 —— 该判据由契约测试盯着（contract-live-global-search）。
  const zhihuCount = value.items.filter((item) => item.contentType !== '').length;
  if (zhihuCount === 0) return `${base} 的全网结果（纯站外来源）`;
  if (zhihuCount === total) return `${base} 的知乎结果`;
  return `${base} 的全网结果（含 ${String(zhihuCount)} 条知乎站内）`;
}

/**
 * 把秒级时间戳渲染成 `YYYY-MM-DD`（UTC）。
 *
 * 纯函数：只读入参、不读时钟、不引入本地时区 —— 否则同一份会话日志在不同机器上
 * 回放出的日期会不一样（红线 3）。
 *
 * @param seconds - 秒级 Unix 时间戳。
 * @returns 日期字符串；无效输入返回空串，由调用方整段省略。
 */
function formatDate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

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
 * @param context - 本次调用的参数上下文（见 {@link SearchRenderContext}）。
 * @returns 单个文本块。
 */
export function renderSearch(value: SearchOutput, context: SearchRenderContext = {}): ContentBlock[] {
  if (!value.ok) {
    const lines = [`❌ 搜索失败：${value.error?.message ?? '未知错误'}`];
    if (value.error?.hint !== undefined && value.error.hint !== '') lines.push(value.error.hint);
    return [{ type: 'text', text: lines.join('\n') }];
  }

  const scopeNoun = context.scope === 'global' ? '全网内容' : '知乎内容';

  if (value.items.length === 0) {
    // 首句必须自带条件限定：一律写「未找到」会把「被筛掉了」说成「不存在」，
    // 那是首因效应下最难纠正的一类误导。
    const head =
      context.filtered === true
        ? `当前筛选条件下未命中关于 "${value.query}" 的${scopeNoun}。`
        : `未找到关于 "${value.query}" 的${scopeNoun}。`;
    const tail =
      context.minValue === undefined
        ? ''
        : `下限 ${String(context.minValue)} 只在本次检索到的候选中筛选，不代表知乎没有相关的高赞内容。`;
    return [{ type: 'text', text: head + tail }];
  }

  const lines: string[] = [`${headerFor(value, context)}：`, ''];
  for (const item of value.items) {
    lines.push(`### [${escapeLinkText(item.title)}](${item.url})`);
    const meta = [`**作者**: ${item.author || '匿名'}`];
    // 点赞段只对知乎内容渲染。
    // 全网搜索会混进第三方网页：外站没有「知乎点赞」这回事，上游对它恒报 0，
    // 渲染出来就是把「不适用」说成「没人赞」——所以连同缺失一起整段省略。
    if (item.contentType !== '' && item.voteUpCount !== undefined) meta.push(`**点赞**: ${String(item.voteUpCount)}`);
    // 评论数与点赞同源：外站没有「知乎评论」这回事，空类型时整段省略。
    if (item.contentType !== '' && item.commentCount !== undefined) meta.push(`**评论**: ${String(item.commentCount)}`);
    // 时间戳转日期，模型不必自己做时间戳算术；缺失时整段省略。
    const date = item.editTime === undefined ? '' : formatDate(item.editTime);
    if (date !== '') meta.push(`**时间**: ${date}`);
    // 类型缺失时整段省略，而不是渲染成空的「类型: 」。
    if (item.contentType !== '') meta.push(`**类型**: ${item.contentType}`);
    lines.push(meta.join(' | '));
    lines.push(`> ${item.snippet}`);
    lines.push('');
  }
  // 到顶：请求超过端点上限、且返回条数正好等于上限 —— 说明是被单次上限截断的，
  // 不是「全网只有这么多」。不写出来，模型会把上限当成全集。
  const capped =
    context.maxCount !== undefined &&
    context.requestedCount !== undefined &&
    context.requestedCount > context.maxCount &&
    value.items.length === context.maxCount;

  // 比请求的条数少：可能是候选本来就不够，也可能是被下限筛掉了。
  // 不写出来，模型会把「筛掉了」读成「知乎只有这些」。
  if (capped) {
    lines.push(
      `> 已返回 ${String(value.items.length)} 条，达到本工具的单次检索上限（${String(context.maxCount)} 条）。要更多，请换关键词或收窄条件后重搜。`,
      '',
    );
  } else if (
    context.minValue !== undefined &&
    context.requestedCount !== undefined &&
    value.items.length < context.requestedCount
  ) {
    lines.push(
      `> 本次筛出 ${String(value.items.length)} 条（请求 ${String(context.requestedCount)} 条）：下限只在本次检索到的候选中生效，不是全库排序；要更多可放宽下限或换关键词。`,
      '',
    );
  }
  // hasMore 是模型唯一能据此改行为的信号：工具没有翻页参数，
  // 不写出来模型就会以为这就是全部结果。zhihu_search 的它恒为 false，因此不出现。
  if (value.hasMore) {
    lines.push('> 结果未全部返回。要更多，请收窄关键词或补充过滤条件后重搜。', '');
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
