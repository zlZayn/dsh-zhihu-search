/**
 * 语义化参数 → 知乎原始语法编译器（防幻觉核心）。
 *
 * 红线：模型永远只传语义化 JSON，绝不接触 `SortBy` / `Filter` 原始字符串。
 * 理由：知乎这两个参数是字符串微语法，模型写错一个引号只会得到 10001，
 * 而它无法从错误里学到正确语法 —— 那就是幻觉的温床。
 *
 * 本文件的全部语法结论均来自 2026-09-12 生产实测：
 * - `VoteUpCount:desc` / `:asc` 有效，且支持 `:(min,)` 下限过滤
 * - 未收录字段返回 `10001 invalid SortBy field`
 * - 站内搜索的 `Filter` **只认 publish_time**，传 `host` 得到 `10001 invalid Filter expression`
 * - 全网搜索接受 `host=="..."`，但明确拒绝知乎域名
 */

/** 编译器拒绝输入时抛出的错误。它属于「参数错」，重试无意义。 */
export class CompileError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'CompileError';
    this.hint = hint;
  }
}

/** 语义化排序字段 → 知乎字段名。实测收录，未列出的字段知乎会拒绝。 */
export const SORT_FIELD_MAP = {
  voteUpCount: 'VoteUpCount',
  commentCount: 'CommentCount',
  editTime: 'EditTime',
} as const;

/** 排序字段的模型可见取值；`default` 表示不排序，交由知乎相关性排序。 */
export const SORT_FIELDS = ['default', 'voteUpCount', 'commentCount', 'editTime'] as const;
/** 排序字段类型。 */
export type SortField = (typeof SORT_FIELDS)[number];
/** 排序方向。 */
export type SortOrder = 'asc' | 'desc';

/** {@link compileSortBy} 的输入。 */
export interface SortBySpec {
  /** 语义化字段名；`default` 或省略表示不排序。 */
  readonly sortField?: SortField;
  /** 方向，默认 `desc`（降序）。 */
  readonly order?: SortOrder;
  /** 排序字段的下限（含）。 */
  readonly minValue?: number;
}

/**
 * 编译 `SortBy`。
 *
 * @param spec - 语义化排序意图。
 * @returns 知乎 SortBy 字符串；`default`/省略时返回 `undefined`（即不传该参数）。
 * @throws CompileError 当字段不受支持或下限非法时。
 */
export function compileSortBy(spec: SortBySpec): string | undefined {
  const field = spec.sortField;
  if (field === undefined || field === 'default') return undefined;

  const mapped = SORT_FIELD_MAP[field];
  if (mapped === undefined) {
    throw new CompileError(`不支持的排序字段：${String(field)}`, `可用字段：${SORT_FIELDS.join(' / ')}`);
  }

  const order: SortOrder = spec.order ?? 'desc';
  const min = spec.minValue;
  if (min === undefined) return `${mapped}:${order}`;

  if (typeof min !== 'number' || !Number.isFinite(min)) {
    throw new CompileError('minValue 必须是有限数字。', '例如 minValue: 100 表示「点赞数不少于 100」。');
  }
  return `${mapped}:${order}:(${String(Math.trunc(min))},)`;
}

/**
 * 判断主机名是否属于知乎域。
 *
 * 知乎全网搜索**明确拒绝** `host=="zhihu.com"` 及其子域
 * （实测报文：`host filter does not support Zhihu domains; use zhihu_search`）。
 * 提前拦下比让模型看到 10001 更有价值：我们能顺便告诉它正确做法。
 *
 * @param host - 已归一化的主机名。
 * @returns 是否属于知乎域。
 */
export function isZhihuDomain(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, '');
  return normalized === 'zhihu.com' || normalized.endsWith('.zhihu.com');
}

/** 过滤表达式的作用域。两个端点的语法互不兼容，必须显式区分。 */
export type FilterScope = 'zhihu' | 'global';

/** {@link compileFilter} 的输入。 */
export interface FilterSpec {
  /** 站点域名，仅全网搜索支持。 */
  readonly site?: string;
  /** 发布时间下界（含）。 */
  readonly publishedAfter?: string | number;
  /** 发布时间上界（含）。 */
  readonly publishedBefore?: string | number;
}

/**
 * 把日期归一化为秒级 Unix 时间戳。
 *
 * ⚠ 可复现性陷阱：JS 对 `'2023-01-01T10:00:00'`（无时区）按**本机时区**解释。
 * 同一份输入在不同机器上会得到不同时间戳，进而产生不同请求与不同缓存键。
 * 因此无时区信息的输入一律按 UTC 补齐 `Z`。
 *
 * @param input - `YYYY-MM-DD`、ISO 8601 字符串，或已是秒级时间戳的数字。
 * @returns 秒级 Unix 时间戳。
 * @throws CompileError 当输入无法解析时。
 */
export function toUnixSeconds(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) {
      throw new CompileError('时间戳必须是正数。', '知乎使用秒级时间戳，例如 1672531200。');
    }
    return Math.trunc(input);
  }

  const raw = input.trim();
  if (raw === '') throw new CompileError('时间不能为空。', '请用 YYYY-MM-DD，例如 2023-01-01。');
  if (/^\d+$/.test(raw)) return Math.trunc(Number(raw));

  // 纯日期或缺少时区的本地时间：统一按 UTC 解释。
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const normalized = hasTimezone ? raw : `${dateOnly ? raw : raw.replace(' ', 'T')}Z`;

  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) {
    throw new CompileError(`无法解析时间：${input}`, '请用 YYYY-MM-DD 或 ISO 8601，例如 2023-01-01。');
  }
  return Math.floor(ms / 1000);
}

/**
 * 编译 `Filter`。
 *
 * ⚠ 两个端点的语法互不兼容，**不能共用一份输出**：
 * 站内搜索只认 `publish_time`；全网搜索才认 `host`。
 * 传错会得到 10001，而不是被静默忽略。
 *
 * @param spec - 语义化过滤意图。
 * @param scope - 目标端点，默认 `global`（能力最全的一端）。站内搜索必须显式传 `'zhihu'`。
 * @returns 知乎 Filter 表达式；无任何条件时返回 `undefined`。
 * @throws CompileError 当条件与目标端点不兼容时。
 */
export function compileFilter(spec: FilterSpec, scope: FilterScope = 'global'): string | undefined {
  const parts: string[] = [];

  if (spec.site !== undefined && spec.site.trim() !== '') {
    if (scope === 'zhihu') {
      throw new CompileError(
        '知乎站内搜索不支持按站点过滤。',
        '站内搜索的所有结果本来就来自知乎；要按站点过滤请改用全网搜索工具。',
      );
    }
    const host = normalizeHost(spec.site);
    if (isZhihuDomain(host)) {
      throw new CompileError(
        '全网搜索不接受知乎域名作为 host 过滤条件。',
        '要搜知乎内容请直接用站内搜索工具，全网搜索会返回本次调用错误。',
      );
    }
    // 字符串值必须加双引号 —— 这是知乎 Filter 语法的硬要求。
    parts.push(`host=="${host}"`);
  }

  if (spec.publishedAfter !== undefined) parts.push(`publish_time>=${String(toUnixSeconds(spec.publishedAfter))}`);
  if (spec.publishedBefore !== undefined) parts.push(`publish_time<=${String(toUnixSeconds(spec.publishedBefore))}`);

  return parts.length === 0 ? undefined : parts.join(' AND ');
}

/**
 * 把用户给的站点值归一化为主机名。
 *
 * 模型可能传 `github.com`，也可能传整个 `https://github.com/a/b`；
 * 后者直接拼进 Filter 会形成非法表达式，所以这里统一剥成主机名。
 */
function normalizeHost(input: string): string {
  const raw = input.trim();
  const withoutScheme = raw.replace(/^https?:\/\//i, '');
  const host = withoutScheme.split('/')[0] ?? '';
  const withoutPort = host.split(':')[0] ?? '';
  const cleaned = withoutPort.toLowerCase();
  if (cleaned === '') throw new CompileError(`无法解析站点：${input}`, '请传域名，例如 github.com。');
  return cleaned;
}
