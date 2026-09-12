# test/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

本目录特有约束：

- 默认从 `src/` 导入（vitest 直跑 TypeScript）；只有产物级测试从 `lib/` 导入，两类不可混用，见 [README.md](README.md)。
- 时间相关断言必须注入 `now`，不得依赖真实时钟，否则会在 CI 上随机失败。
- 外壳预置模块（`PLATFORM_MODULES`）在测试中用替身：`ui-primitives` 是浏览器静态库，Node 中导入会失败。
- 断言失败时先判断是**代码错**还是**测试错**：不为让测试通过而改产品代码，也不为迁就实现而弱化断言。
- 红线以测试固化，红线条目本身就是契约，删改用例等于改契约 → [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)。
- 覆盖范围与测试约定写在 [README.md](README.md)，本文件只写约束。
