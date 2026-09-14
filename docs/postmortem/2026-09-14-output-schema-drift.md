## Postmortem: v1.4.0 输出 schema 漂移，两个搜索工具整体失效（2026-09-14）

- **摘要**：v1.4.0 给搜索结果加了 `commentCount` / `editTime` 两个字段（类型与投影都改了），
  却漏改 `output.schema`。宿主按该 schema 校验工具返回值，而它是 `additionalProperties: false` ——
  于是**只要有结果，整个调用就被判非法**：`"value.items[0].commentCount" is not a declared property`。
  用户验收第 1 条即命中。214 条测试当时全绿。
- **时间线**：实现 D4 → `npm test` 全绿 → minor 发版 v1.4.0 → 用户按验收清单实调 → 第 1 条即失败
  → 定位到 schema 未同步 → 补声明 → 加守卫用例（先证明它对 v1.4.0 状态会红）→ 发 v1.4.1。
- **根因**：同一个事实在仓库里有**三份副本** —— `src/types.ts` 的 `SearchOutput`、投影层的对象字面量、
  `output.schema`。前两份由 TypeScript 与单测照看，第三份**只被宿主照看**，而测试从不走宿主那条校验路径：
  既有用例直接读 `execute()` 的返回值，`schema 完全一致` 的用例只比较两个工具**彼此**相等
  （两边一起错，正是相等的一种）。
- **防再犯**：新增 `test/tool.test.ts` 的「Canonical Output 必须通过自己声明的 output schema」四连用例，
  用宿主**同一个** `validateJsonSchemaValue`（`@deepseek-ai/dsh-tools`）校验三个工具的成功值与失败值，
  并附一条「多一个未声明字段必须被判非法」的反向控制，防止守卫本身变空。
  验证方式：临时把 schema 改回 v1.4.0 的样子，该用例复现出与宿主一字不差的报错。
- **教训**：**「测试全绿」只覆盖它走的那条路径**。跨进程契约（工具返回值 → 宿主校验）必须用宿主的校验器
  在测试里跑一遍，否则等于没测。这次是 214 条绿测与一次线上失败之间的全部差距。
- **关联**：[决策记录](../../.agents/notes/2026-09-14-result-semantics-and-contract-tests.md) ·
  [架构说明](../ARCHITECTURE.md) 的「防错清单 → 本实现」 · [AGENTS.md](../../AGENTS.md) 活跃坑
