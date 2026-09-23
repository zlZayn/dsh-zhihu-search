# src/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

本目录特有约束：

- host 半体只有 `index.ts` 可以 import Cordis（`@deepseek-ai/cordis`），另一半体的等价入口是 `client/index.tsx`。其他模块引用 `ctx` 会让它们无法脱离框架单测 → [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「模块骨架与依赖方向」。
- 值导入 `@deepseek-ai/dsh-tools` 不算破例：三个 `tools/*.ts` 都这么做，框架侧能力经 [tools/deps.ts](tools/deps.ts) 收口。
- `present/` 与 `utils/` 里禁止运行时 import `@deepseek-ai/*`；DSH 类型一律用 `import type`，否则纯函数测试会拖入整条运行时依赖链 → 同上。
- `utils/describe-error.ts` 是**零导入的叶子**，供上游模块复用（最上游的 `transport.ts` 也用）。**不要把「异常 → 一行文本」并回 `utils/errors.ts`** —— 后者值导入 `transport.ts` / `state.ts` / `compiler.ts` 取错误类做 `instanceof` 判定，并进去会让 `transport.ts` 反向导入成环 → 见 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「模块骨架与依赖方向」。
- 任何状态都不得声明在模块顶层，必须经由 `ctx.effect()` 创建并释放 → 见架构文档「不可破坏的约束」。
- `agent/created` 监听器里**同步抛错会否决 agent 创建并回滚**（只有 Promise 拒绝降级为 warn，DSH `core/agent` 实测）→ 该钩子里任何可能抛错的动作都要 try/catch，且只吞预期失败（无工具服务、名字不在链上）。
- 文件职责与变更路由写在 [README.md](README.md)，本文件只写约束。
