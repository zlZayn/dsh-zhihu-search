# utils/ — 纯函数工具层

- 职责：参数编译与文本清洗。无状态、无 I/O、无 Cordis 依赖。

## 文件索引

- `compiler.ts`：语义化参数 → 知乎 `SortBy`/`Filter` 字符串。导出 `compileSortBy`、`compileFilter`、`toUnixSeconds`、`isZhihuDomain`、`SORT_FIELDS`、`CompileError`。被 `tools/` 依赖。
- `text.ts`：剥高亮标签、解码实体、截断摘要、剥 URL 跟踪参数。导出 `sanitizeSnippet`、`stripTrackingParams`、`decodeEntities`。被 `tools/` 依赖。
- `errors.ts`：任意异常 → Canonical Error。导出 `mapError`。被 `tools/` 依赖。

## 变更影响路由

- 改编译器语法 → 先用生产凭据复核，改 `test/compiler.test.ts`，同步 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的偏差表。
- 改文本清洗 → 跑 `test/text.test.ts`；这些函数决定模型实际看到的内容。
- 改「拒绝哪些输入」→ 同步 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「防错清单」；新增拒绝条件必须同时补 `test/compiler.test.ts` 用例与可据以纠正的 `hint`。

## 参考

- 为什么编译器是唯一出口 → 见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「不可破坏的约束」
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
