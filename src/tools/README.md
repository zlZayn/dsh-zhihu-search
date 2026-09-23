# tools/ — 工具定义层

- 职责：把知乎能力包装为 DSH 工具，产出 Canonical Output。

## 文件索引

- `deps.ts`：各工具共用的依赖包与缓存键计算。
- `search.ts`：`zhihu_search` 站内搜索。不接受站点过滤。
- `global-search.ts`：`zhihu_global_search` 全网搜索，本地拒绝知乎域名。
- `search-shared.ts`：两搜索工具逐字共用的三件套（`output.schema` 常量、`projectItem` 投影、条数解析）。
- `zhida.ts`：`zhihu_zhida` 知乎直答。走 SSE，语义化档位映射为真实模型 id。

## 契约要点

- 每个工具的 `execute` **绝不 throw**：失败一律转为 `{ok:false, error}` → 见架构文档「错误契约」。
- 两个搜索工具的 `output.schema` 必须完全一致，由 `test/tool.test.ts` 守护。
- 缓存只写成功结果，失败结果不入缓存 → 理由见架构文档「缓存与限流」。
- 站内搜索带 `minValue` 时**按端点上限取候选池**（`FILTERED_CANDIDATE_COUNT`），缓存里存**池子**、只在返回路径上截断 —— 上游的区间是「候选内筛选」，条数要得越小越容易筛空。
- 输出字段与排序旋钮必须对称：`sortField` 能排的维度（点赞 / 评论 / 时间）都要在 Canonical Output 里有读数。
- **未知参数必须本地拒绝**：宿主给的参数 schema 是开放的（DSH 的 DSL 不接受 `additionalProperties: false`），未知键会被静默丢弃 —— 不拦，模型传 `page=2` 就会拿到第一页却以为翻页成功。白名单由各工具的 `PARAM_NAMES` 提供，与参数定义的一致性由 [test/tool.test.ts](../../test/tool.test.ts) 断言守着。
- **判定值要区分「原始请求」与「夹取后」**：渲染层的到顶判定比的是模型**原始**请求条数；传夹取后的值会让条件恒假、提示变死代码（v1.5.1 的回归 → [复盘](../../docs/postmortem/2026-09-14-dead-code-cap-note.md)）。
- 上游没报的字段不得编造：`contentType` 缺失时留空串，`voteUpCount` 缺失时整个键省略。实测上游从未真的省略过这两个字段，它们是防伪造的兜底。
- 外站网页的类型是空串、点赞恒为占位 0：投影层如实保留，渲染层不展示那个 0。

## 变更影响路由

- 增删工具 → 同步 `src/index.ts` 的注册开关、`Config`、根 [README.md](../../README.md) 能力清单、[test/plugin.test.ts](../../test/plugin.test.ts)。
- 改参数集合 → 触发红线 5，跑 [test/redlines.test.ts](../../test/redlines.test.ts)。
- 改 Canonical Output → 契约变更，同步 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 与 [src/README.md](../README.md)。

## 参考

- 参数与输出的不变约定 → 见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「端点契约」
- 工具描述怎么写（三槽结构、不枚举参数取值）→ 见同一文档的「工具描述约定」
- 参数为何不得静默失效 → 见同一文档的「防错清单」
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
