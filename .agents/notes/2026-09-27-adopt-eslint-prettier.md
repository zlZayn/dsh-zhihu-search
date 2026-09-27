# 决策：引入 ESLint + Prettier，四个编译器开关保留

状态：生效

## 问题

`tsconfig.json` 的四个编译器开关（`noUnusedLocals` / `noUnusedParameters` / `noImplicitReturns` / `noFallthroughCasesInSwitch`）只覆盖「通用 lint 那一档」的一部分。两类问题它结构性覆盖不到：

- **格式类**（缩进 / 引号 / 分号 / import 排序）：编译器不管风格。旧记录自己承认过这一点。
- **React hooks 与 promise 用法**：`react-hooks/exhaustive-deps`、未 await 的 promise —— 本仓有浏览器半体（`src/client/`），这两类是真实故障源，而 tsc 无法表达。

## 决策

引入 ESLint + Prettier，**四个编译器开关原样保留**：

- devDeps：`eslint`、`typescript-eslint`、`@eslint/js`、`globals`、`prettier`、`eslint-config-prettier`。
- `eslint.config.mjs`：flat 配置，Node 全局为主，`src/client` 另给 browser 全局；末项接 `eslint-config-prettier` 关掉与格式化冲突的规则。
- `.prettierrc.json`：printWidth 100 / 分号 / 单引号（对齐仓内既有写法）；`.prettierignore` 排除 `.md`、`lib/`、`locale/`。
- scripts 加 `lint` / `format` / `format:check`。CI 在 `npm test` 之后加一步 `npm run lint`。

**分工**：开关管「类型与死代码」，ESLint 管「编译器覆盖不到的那一档」。`test/redlines.test.ts` 的「类型检查开关」组**原样保留** —— 它现在守的是「开关不许被悄悄删掉」，不再承载「不引入 linter」的含义。

## 替代方案

- **维持不引入 linter**（本仓 2026-09-20 从 balance 对齐的那条）：它的复审条件是「多人协作，或代码量涨到评审看不完」，两个条件至今都没满足。**本次推翻不是条件触发**，是维护者按统一规范（L3/L4 项目必须有 ESLint + Prettier）主动要求。旧记录保留，用于说明当时为何那样判断。
- **只加 Prettier 不加 ESLint**：格式类解决，但 hooks / promise 两类仍无兜底，等于放弃一半收益。
- **把四开关换成 ESLint 等价规则**：丢掉「一次 `tsc` 就拿到」的零配置收益，且让红线从一个地方分裂到两个地方。
- **biome / oxlint**：启动快、配置少，但生态与规则覆盖不及 typescript-eslint，而本仓有 React 面、需要 hooks 规则。

## 影响

- 新增 6 个 devDeps 与 3 个 config 文件；锁文件重建。
- 全量格式化一次性重排源码，独立一刀、单独 commit。
- 对外行为零变化（纯工具链 + 排版），按 PUBLISHING 的问题链属「零行为变更不发版」。
- 旧记录 [四个编译开关 + 发布态守卫脚本](2026-09-20-four-switches-and-release-check.md) 状态改「被取代」，指针指向本条。
- **跨仓**：容器 `dsh-plugins/AGENTS.md` 的裁定第 4 条**已同批改口径**（2026-09-27）—— 标题由「四个编译器开关代替 linter」改为「四个编译器开关 + ESLint 各自分工」，档位仍「最好一致」，并把 `dsh-workbuddy-bridge` 一并纳入覆盖面。
