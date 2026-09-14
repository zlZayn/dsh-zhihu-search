# present/ — 纯函数呈现层

- 职责：模型可见 Markdown、可持久化元数据、UI 卡片。三者严格分离。
- 硬性特征：**没有任何运行时依赖**（DSH 类型全部 `import type`），因此可被单元测试直接调用。

## 文件索引

- `search.ts`：搜索类工具共用。导出 `renderSearch`（第二参数是本次调用的 `SearchRenderContext`：条数与下限，用来把「被下限筛少」与「知乎没有」说清楚）、`searchMetaFromValue`、`searchMetaFromResult`、`presentSearchCall`、`presentSearchResult` 与 `SearchMeta` / `SearchRenderContext` 类型。被 `tools/search.ts` 与 `tools/global-search.ts` 依赖。
- `zhida.ts`：直答专用。导出 `renderZhida`、`presentZhidaCall`、`presentZhidaResult` —— **刻意不声明 `presentationMeta`**：直答没有可持久化的结构化元数据，为此凑一个空壳只会把「三者严格分离」变成形式主义。

## 变更影响路由

- 改任一导出 → 跑 `test/presentation.test.ts` 与 `test/redlines.test.ts`（红线 2 与红线 3 的守卫）。

## 参考

- 三层分离的设计理由 → 见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「不可破坏的约束」
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
