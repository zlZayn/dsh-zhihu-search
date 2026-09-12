# 决策：按实测的 DSH 工具契约实现，而非按任务书给的 API（2026-09-12）

已实施。

## 问题

任务书给出的 `defineTool` 模板与本机安装的 `@deepseek-ai/dsh@0.1.5-rc.2` 不兼容，照抄无法编译。

核对结果（`dsh-tools/lib/types/schema.d.ts`、`presentation.d.ts`、`index.d.ts`）：

- `Schema` 并未从 `@deepseek-ai/dsh-tools` 导出；参数用的是纯对象字面量 DSL。
- 没有 `.optional()` / `.min()` / `.max()`；必填靠属性上的 `required: true`，边界要在 `execute` 内自校验。
- `render` 必须返回 `ContentBlock[]`，不是字符串。
- `presentResult` 收到的是 `ToolResult`（`{content, isError, meta?}`），不是 Canonical Value；结构化数据要从 `result.meta` 读回。
- `isConcurrencySafe` 是 `(args) => boolean`，不是布尔常量。
- `WebSource` 没有 `source` 字段，且 `truncated` 必填。

## 决策

以本机安装的真实类型声明为准实现，全部对外契约通过 `tsc` 与测试固化。

## 替代方案

- **按任务书原样写，让维护者自己改**：交付一份编译不过的代码，等于把验证成本转回给维护者。
- **只依赖文档不读安装包**：文档描述的是另一版本，且部分描述与实现不符（见另一条决策记录）。
- **把 `@deepseek-ai/*` 放进 `dependencies` 以便本地直接跑**：会让 Cordis Context 出现两个实例，破坏服务单例，正是红线禁止的事。

## 影响

- 契约形状与 DSH 官方工具（如 `dsh-tool-web`）保持一致，可直接对比排障。
- 代价：任务书中的模板代码不能逐字复用，需要按其意图重写。
