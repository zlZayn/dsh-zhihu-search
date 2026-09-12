# src/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

本目录特有约束：

- 只有 `index.ts` 可以 import Cordis（`@deepseek-ai/cordis`）。其他模块引用 `ctx` 会让它们无法脱离框架单测。
- `present/` 与 `utils/` 里禁止运行时 import `@deepseek-ai/*`；DSH 类型一律用 `import type`，否则纯函数测试会拖入整条运行时依赖链。
- 任何状态都不得声明在模块顶层，必须经由 `ctx.effect()` 创建并释放。
- 文件职责与变更路由写在 [README.md](README.md)，本文件只写约束。
