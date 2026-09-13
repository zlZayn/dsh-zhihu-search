# utils/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

本目录特有约束：

- 全部导出必须是**纯的**：不得读时钟、环境变量、缓存或网络（导出的类与类型接口不受此限）。可测性依赖这一点 → [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「不可破坏的约束」。
- 禁止运行时 import `@deepseek-ai/*`，类型一律 `import type` → 同上。
- 日期必须先归一化到 UTC 再转时间戳，否则同一输入在不同机器产生不同缓存键 → 见架构文档「防错清单」。
- 编译失败一律抛 `CompileError` 并带 `hint`，不要静默产出坏字符串 → 见架构文档「错误契约」。
