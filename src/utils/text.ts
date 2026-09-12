/**
 * 文本与 URL 清洗 —— 「知乎脏数据 → 干净 Canonical Output」的唯一入口。
 *
 * 为什么独立成模块：这些函数直接决定模型看到什么，且全部是纯函数，
 * 必须能被单独测试。混进工具实现里就测不动，而它们最容易出静默错误。
 */

/** 摘要最大字符数。超过会截断，避免单条结果吃掉过多上下文。 */
export const MAX_SNIPPET_CHARS = 400;

/** 知乎高亮标签。实测 `ContentText` 的高亮就是 `<em>` / `</em>`。 */
const HIGHLIGHT_TAG = /<\/?em>/gi;

/**
 * 兜底删除任意残留标签。
 *
 * 为什么连未知标签也删：知乎摘要理论上只含 `<em>`，但这是**外部输入**。
 * 任何未被删除的 `<script>`、`<img onerror=...>` 都会被拼进 Markdown 交给模型。
 * 宁可删掉一个合法的尖括号，也不让外部 HTML 进入上下文。
 */
const ANY_TAG = /<[^>]*>/g;

const ENTITY = /&(amp|lt|gt|quot|#39|nbsp);/gi;
const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** 解码常见 HTML 实体。知乎摘要里的引号与省略号常被转义。 */
export function decodeEntities(input: string): string {
  return input.replace(ENTITY, (match) => ENTITY_MAP[match.toLowerCase()] ?? match);
}

/**
 * 清洗摘要：去高亮标签、解码实体、折叠空白、截断。
 *
 * @param input - 原始 `ContentText`，可能含 `<em>` 与转义实体。
 * @param maxChars - 截断上限，默认 {@link MAX_SNIPPET_CHARS}。
 * @returns 可直接放进 Markdown 的纯文本。
 */
export function sanitizeSnippet(input: string, maxChars: number = MAX_SNIPPET_CHARS): string {
  const cleaned = decodeEntities(input.replace(HIGHLIGHT_TAG, '').replace(ANY_TAG, ''))
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length <= maxChars ? cleaned : `${cleaned.slice(0, maxChars - 1)}…`;
}

/**
 * 剥离 URL 上的跟踪参数。
 *
 * 知乎在返回的 `Url` 上固定追加 `utm_medium=openapi_platform`，
 * 并且额外带一个 `utm_source=<凭据指纹>` —— 后者会泄露调用方身份，
 * 且会让「同一篇文章」在模型眼里变成不同 URL，破坏去重。
 *
 * @param input - 原始 URL。
 * @returns 去掉全部 `utm_*` 参数后的 URL；无法解析时原样返回。
 */
export function stripTrackingParams(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return input.trim();
  }
  const keys: string[] = [];
  parsed.searchParams.forEach((_value, key) => {
    if (key.toLowerCase().startsWith('utm_')) keys.push(key);
  });
  for (const key of keys) parsed.searchParams.delete(key);
  // 参数被清空后会留下一个孤立的 '?'，Markdown 链接里很难看。
  return parsed.search === '' && input.includes('?') ? `${parsed.origin}${parsed.pathname}${parsed.hash}` : parsed.toString();
}
