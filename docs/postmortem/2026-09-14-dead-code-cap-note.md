## Postmortem: v1.5.1 的「到顶提示」是死代码（2026-09-14）

- 摘要：v1.5.1 新增「达到单次检索上限」提示，判定条件为 `requestedCount > maxCount`；而工具接线传入的是**夹取后**的值（恒 ≤ maxCount），条件永假 —— 提示从未出现过。222 条单测全绿。
- 时间线：v1.5.1 发布 → 独立会话的工具质检员读源码发现判定与接线矛盾 → 本地复现（`count=20` 回满 10 条无提示）→ 拆出 `rawRequestedCount` 并补接线级用例 → v1.5.2。
- 根因：判定函数（`renderSearch`）与它的输入来源（工具接线）分离；单测直接喂 `requestedCount: 50`，覆盖了函数却没有任何用例走「execute → render」这条真实路径。
- 防再犯：两个搜索工具各补一条**接线级**回归（`execute(count>上限)` → `render` → 断言提示存在）；[架构文档](../ARCHITECTURE.md) 的防错清单记入「判定输入的语义必须与判定条件一致」。
- 关联：[决策记录](../../.agents/notes/2026-09-14-honest-render.md) · [输出 schema 漂移](2026-09-14-output-schema-drift.md)（同一类「单测覆盖不到接线」）
