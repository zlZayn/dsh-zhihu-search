# utils/ — 纯函数工具层

- 职责：参数编译、文本清洗与错误规范化。无状态、无 I/O、无 Cordis 依赖。

## 文件索引

- `compiler.ts`：语义化参数 → 知乎 `SortBy`/`Filter` 字符串。导出函数 `compileSortBy` / `compileFilter` / `toUnixSeconds` / `isZhihuDomain` / `assertKnownParams`（参数白名单），常量 `SORT_FIELDS`（字段白名单）与 `SORT_FIELD_MAP`，类型 `SortField` / `SortOrder` / `SortBySpec` / `FilterScope` / `FilterSpec`，以及 `CompileError`。`compileFilter` 的 scope 默认 `global`，站内必须显式传 `'zhihu'`。被 `tools/` 依赖。
- `text.ts`：剥高亮标签、解码实体、截断摘要、剥 URL 跟踪参数。导出 `sanitizeSnippet`、`stripTrackingParams`、`decodeEntities`、`MAX_SNIPPET_CHARS`。被 `tools/` 依赖。
- `errors.ts`：任意异常 → Canonical Error。导出 `mapError` 与 `CanonicalError` 接口。这是 `utils/` 里唯一有内部值导入的文件：从 `transport.ts`、`state.ts`、`compiler.ts` 取错误类做 `instanceof` 判定。被 `tools/` 依赖。

## 变更影响路由

- 改编译器语法 → 先用生产凭据复核，改 `test/compiler.test.ts`，同步 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「与知乎官方文档的偏差」。
- 改文本清洗 → 跑 `test/text.test.ts`；这些函数决定模型实际看到的内容。
- 改「拒绝哪些输入」→ 同步 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「防错清单」；新增拒绝条件必须同时补 `test/compiler.test.ts` 用例与可据以纠正的 `hint`。

## 参考

- 为什么编译器是唯一出口 → 见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「不可破坏的约束」
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
