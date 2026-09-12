# present/ — 纯函数呈现层

- 职责：模型可见 Markdown、可持久化元数据、UI 卡片。三者严格分离。
- 硬性特征：**没有任何运行时依赖**（DSH 类型全部 `import type`），因此可被单元测试直接调用。

## 文件索引

- `search.ts`：搜索类工具共用。导出 `renderSearch`、`searchMetaFromValue`、`searchMetaFromResult`、`presentSearchCall`、`presentSearchResult`。被 `tools/search.ts` 与 `tools/global-search.ts` 依赖。
- `zhida.ts`：直答专用。导出 `renderZhida`、`presentZhidaCall`、`presentZhidaResult`。

## 变更影响路由

- 改任一导出 → 跑 `test/presentation.test.ts` 与 `test/redlines.test.ts`（红线 2 与红线 3 的守卫）。

## 参考

- 三层分离的设计理由 → 见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「不可破坏的约束」
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
