# tools/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

本目录特有约束：

- 模型可见参数只能是语义化名称；出现 `SortBy`、`Filter`、`VoteUpCount`、`publish_time` 即为红线 5 违规，会被测试拦下 → [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「不可破坏的约束」。
- `execute` 必须有 `try/catch`，且在 `catch` 中返回结构化错误而不是重新抛出 → 见架构文档「错误契约」。
- 缓存键必须用**归一化后**的参数，否则 `count=99` 与 `count=10` 会各占一个键 → 见架构文档「缓存与限流」。
- 每个工具都要有 `timeoutMs`、`isConcurrencySafe`、`presentCall`、`presentResult`，缺一项都会让 UI 或超时策略降级 → [test/redlines.test.ts](../../test/redlines.test.ts)。
- 上游没报的字段不得编造：`contentType` 留空串、`voteUpCount` 省略键 → [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「防错清单」。
