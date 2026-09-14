# tools/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

本目录特有约束：

- 模型可见参数只能是语义化名称；出现 `SortBy`、`Filter`、`VoteUpCount`、`CommentCount`、`publish_time`、`host==`、`desc:(` 即为红线 5 违规，会被测试拦下（完整清单以 [test/redlines.test.ts](../../test/redlines.test.ts) 为准）→ [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「不可破坏的约束」。
- `execute` 必须有 `try/catch`，且在 `catch` 中返回结构化错误而不是重新抛出 → 见架构文档「错误契约」。
- 缓存键必须用**归一化后**的参数，否则 `count=99` 与 `count=10` 会各占一个键 → 见架构文档「缓存与限流」。
- **判定输入的语义必须与判定条件一致**：渲染层的到顶判定吃的是**原始**请求条数，缓存键与请求吃的是**夹取后**的条数 —— 两者不可互换，弄反就是永不触发的死代码（v1.5.1 的回归 → [复盘](../../docs/postmortem/2026-09-14-dead-code-cap-note.md)）。
- 未知参数必须本地拒绝（`assertKnownParams`）：宿主参数 schema 是开放的，静默忽略会让模型产生「翻页成功」这类幻觉 → [README.md](README.md) 的契约要点。
- 每个工具都要有 `timeoutMs`、`isConcurrencySafe`、`presentCall`、`presentResult`，缺一项都会让 UI 或超时策略降级 → [test/redlines.test.ts](../../test/redlines.test.ts)。
- 超时预算**不得写死**：直答的 `timeoutMs` 由 `deps.streamTimeoutMs` 加余量推导，且必须晚于传输层超时 —— 否则配置调大后先被 DSH 截断，失败会从结构化错误退化成裸超时 → [zhida.ts](zhida.ts) 与架构文档的「错误契约」。
- 上游没报的字段不得编造：`contentType` 留空串、`voteUpCount` 省略键；空串与占位 0 都不是真实值 → [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「防错清单」。
- 描述的结果形态槽要写明模型拿得到什么，拿不到的也要点名（搜索结果不含图片）→ 见架构文档「工具描述约定」。
