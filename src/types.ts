/**
 * dsh-zhihu-search 共享类型 —— 知乎开放平台「原始响应」与工具「Canonical Output」。
 *
 * 为什么两类类型共用一个文件：它们是 transport.ts 的输入与输出，字段名一一对应。
 * 放一起意味着知乎侧任何字段改名都能在这一个文件里被审计到，不会散落各处。
 *
 * 命名约定（不要混用，混用即产生静默 null）：
 * - 原始 API 类型：PascalCase，字段名与知乎文档逐字一致，只出现在 transport.ts 内部。
 * - Canonical Output 类型：camelCase，是唯一跨进程（工具结果 / 会话日志）的契约。
 */

// ===========================================================================
// 1. 知乎开放平台原始响应结构（PascalCase，字段名对齐官方文档）
// ===========================================================================

/**
 * 知乎开放平台统一响应信封。
 *
 * ⚠ 两个致命坑，都源于「直觉与知乎不一致」：
 * 1. 成功码是 `0`，**不是** HTTP 式的 200。写成 `Code === 200` 会 100% 误判失败。
 * 2. 字段是 PascalCase 的 `Code`/`Message`/`Data`，**不是** `code`/`message`/`data`。
 *    写成小写会得到 `undefined`，而 `undefined !== 0` 同样静默误判为失败。
 */
export interface ZhihuApiResponse<T> {
  /** 0 = 成功；10001 参数错误；20001 鉴权失败；30001 频率限制；90001 内部错误。 */
  Code: number;
  /** 人类可读消息。成功时可能是空串，不要用它判断成败。 */
  Message: string;
  /** 业务载荷。失败时可能为 null，取用前必须判空。 */
  Data: T;
}

/**
 * 搜索端点（`GET /api/v1/content/zhihu_search` 与 `.../global_search`）的 `Data` 载荷。
 *
 * ⚠ 官方文档称站内搜索只接受 `Query` 与 `Count`，**实测不成立**：
 * 它同样识别 `SortBy` 与 `Filter`（`Filter` 限 `publish_time`），
 * 只是文档没写。两个端点的 `Filter` 语法互不兼容——
 * 完整偏差见 ARCHITECTURE 的「与知乎官方文档的偏差」。
 */
export interface ZhihuSearchData {
  /**
   * ⚠ 站内搜索按官方文档**固定返回 false**；全网搜索在 12 个宽泛查询的实测里**也全部为 false**。
   * 因此两个端点都不能据此翻页——全网搜索根本没有翻页参数（见 ARCHITECTURE 的防错清单）。
   */
  HasMore: boolean;
  /**
   * 搜索请求标识，排障用，不面向模型。
   * ⚠ 实测**不是游标**：原样传回不改变结果（试过 SearchHashId / HashId / Cursor / Offset / Page / Start）。
   */
  SearchHashId?: string;
  /**
   * 搜索结果条目。
   *
   * ⚠ 官方文档里的 `EmptyReason` 刻意不声明：实测它**只在 `Items` 为空时出现**，
   * 取值恒为字符串「无相关内容」——有结果时字段整个缺席，被过滤空时也不区分原因。
   * 零诊断价值，因此既不进类型也不透出（将来若它开始携带真实原因，再补测后加回）。
   */
  Items?: ZhihuSearchItem[];
}

/**
 * 站内搜索单条结果（精简版：只保留会进入 Canonical Output 的字段）。
 *
 * 官方 Item 还包含 AuthorAvatar / AuthorBadge / RankingScore / CommentInfoList 等字段；
 * 这里刻意不声明——未使用的字段不进类型，就不会被误当作契约。
 */
export interface ZhihuSearchItem {
  Title: string;
  /**
   * ⚠ 刻意是 `string` 而不是 `'Answer' | 'Article'`。
   * 官方文档的取值列写的是「Article / Answer **等**」，即存在未列举的类型
   * （热榜还会混入 Question）。写成封闭联合会让「取到未知类型」这一分支
   * 变成死代码，而它恰恰是生产上真实会发生的情况。
   */
  ContentType: string;
  ContentID: string;
  /** 可能包含 <em> 高亮标签，进入 Canonical Output 前必须清洗。 */
  ContentText: string;
  /** 含 utm_medium=openapi_platform 溯源参数，进入 Canonical Output 前必须剥离。 */
  Url: string;
  CommentCount: number;
  VoteUpCount: number;
  AuthorName: string;
  /** 秒级时间戳（发布时间或更新时间）。 */
  EditTime: number;
  /**
   * ⚠ 取实测与文档的并集：站内搜索**实测返回字符串**（`"4"`），
   * 官方文档又按 1/2/3/4 描述，全网搜索一侧尚未实测。
   * 该字段不进入 Canonical Output，宽类型不会污染模型上下文；
   * 将来若要读它，先对两个端点各测一次再收窄。
   */
  AuthorityLevel: string | number;
}

/**
 * 知乎直答（OpenAI 兼容）错误结构。
 *
 * 直答端点是 OpenAI 兼容形态，**成功时不含 `Code`**，失败时才返回 `error`。
 * 这与上面的 `ZhihuApiResponse` 是两套完全不同的判错逻辑，不能共用一条错误分支。
 */
export interface ZhihuChatError {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | number;
  };
}

// ===========================================================================
// 2. 工具 Canonical Output 结构（camelCase，唯一跨进程契约）
// ===========================================================================

/**
 * `zhihu_search` 的 Canonical Output。
 *
 * 为什么是「纯数据、永不含 UI 逻辑」：
 * 该值会被 lossless-JSON 序列化后写入会话日志，并在历史回放时重新喂给
 * `render` 与 `presentResult`。一旦夹带 Date.now()、缓存状态或网络态，
 * 回放就会得到与实时不一致的结果（DSH 明令 presentationMeta 必须纯函数）。
 */
export interface SearchOutput {
  /** 是否成功。为 false 时 items 必为空数组、error 必有值。 */
  ok: boolean;
  /** 回显查询词，供 render / 历史回放判断问题上下文。 */
  query: string;
  items: Array<{
    title: string;
    url: string;
    /** 已清洗 <em> 标签的纯文本摘要。 */
    snippet: string;
    author: string;
    /**
     * 点赞数。上游没报该字段时**整个键省略**，不兜底成 0。
     *
     * 实测（30 条样本）上游**从未省略**该字段：外站网页也有这个键，值是占位的 `0`，
     * 它不代表「没人赞」。省略分支是防伪造的兜底，外站那个 0 不在渲染层展示。
     */
    voteUpCount?: number;
    /**
     * 评论数。规则与 {@link SearchOutput.items.voteUpCount} 相同：上游没报就整个键省略。
     *
     * 为什么要透出：`zhihu_search` 的 `sortField` 允许按评论数排序，
     * 「能按它排却看不到它」会让模型无法核对，也无法向用户交代。
     */
    commentCount?: number;
    /**
     * 内容时间（秒级 Unix 时间戳；官方定义为发布时间或最后编辑时间）。
     *
     * 与 `sortField: 'editTime'` 对称：给了排序旋钮就必须给得出读数。
     * 渲染层转成日期展示，不在这里做格式化（Canonical Output 只放纯数据）。
     */
    editTime?: number;
    contentType: string;
  }>;
  /**
   * ⚠ 站内搜索该值恒为 false（见 ZhihuSearchData.HasMore 注释）。
   * 保留字段以对齐 Canonical Output 契约，但 render 不得据此提示「可翻页」。
   */
  hasMore: boolean;
  /** 失败详情。kind 用于让模型区分「重试有用」与「重试无用」。 */
  error?: { kind: string; message: string; hint?: string };
}

// ===========================================================================
// 3. 内部工具类型（不跨进程，仅供 transport.ts / 工具实现使用）
// ===========================================================================

/**
 * 错误分类字面量联合。
 *
 * 为什么单独定义而不直接用 string：
 * `SearchOutput.error.kind` 对外是 string（保持契约宽松），
 * 但内部必须收敛到有限集合，否则 mapError 漏掉一个分支不会有人发现。
 */
export type ZhihuErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'local_rate_limit'
  | 'param'
  | 'server'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'parse'
  | 'unknown';

/** 平台错误码 → 内部错误种类的映射表键。 */
export type ZhihuPlatformCode = 0 | 10001 | 20001 | 30001 | 90001;

/**
 * `zhihu_zhida`（知乎直答）的 Canonical Output。
 *
 * `reasoning` 单独成字段而不是并进 `answer`：两者用途不同，
 * 合并会让工具无法选择「只给答案」以节省上下文。
 */
export interface ZhidaOutput {
  ok: boolean;
  /** 回显提问。 */
  question: string;
  /** 实际使用的模型 id（已从语义化档位映射而来）。 */
  model: string;
  /** 正文答案。 */
  answer: string;
  /** 思维链；未请求时为空串。 */
  reasoning: string;
  error?: { kind: string; message: string; hint?: string };
}
