# present/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

本目录特有约束：

- 全部导出必须是纯函数；`presentationMeta` 只允许读 Canonical Value，禁止 `Date.now()`、环境变量、缓存与网络 → [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「不可破坏的约束」。
- 模型可见文本里不得出现 UI 字段（`card`/`sources`/UI 结构）：[test/redlines.test.ts](../../test/redlines.test.ts) 从工具侧守，[test/presentation.test.ts](../../test/presentation.test.ts) 从纯函数侧守。
- 模型可见文本必须诚实：到顶必说、来源按构成分流、空态首句带条件限定、到顶与「被筛少」互斥 —— 不把工具的边界说成结果的边界 → [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「模型可见文本的诚实性」，由 [test/presentation.test.ts](../../test/presentation.test.ts) 固化。
- 禁止运行时 import `@deepseek-ai/*`。一旦变成值导入，本层的纯度测试会连带拖入整条运行时依赖 → 见架构文档「不可破坏的约束」。
- 外部数据（标题、摘要）进入 Markdown 前必须转义或清洗 → 见架构文档「防错清单」。
- `presentResult` 必须能容忍畸形 meta：会话日志可能来自旧版本，形状不符时返回 `undefined` 而不是抛错 → 见架构文档「不可破坏的约束」。
- 字段缺失、或字段存在但不适用（外站网页的占位 0 赞），都整段省略而不是渲染成 `0` → 见架构文档「防错清单」。
