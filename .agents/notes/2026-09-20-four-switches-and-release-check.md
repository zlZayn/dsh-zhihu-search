# 四个编译开关 + 发布态守卫脚本：从 balance 对齐过来

**日期**：2026-09-20
**状态**：已落地
**关联**：工作区跨仓裁定（`dsh-plugins/AGENTS.md` 的「跨仓一致性分三档」）——四开关属「最好一致」，
发布态不变量属「必须一致」，都按「断言各仓各写」的方案落。

## 问题

两个「通用 lint 那一档」的缺口长期单侧存在：

1. **四开关**：balance 的 `tsconfig.json` 有 `noUnusedLocals` / `noUnusedParameters` /
   `noImplicitReturns` / `noFallthroughCasesInSwitch`，并有红线断言守着；本仓一直没有。
   这组开关是"不引入 linter"这个决定的全部依据 —— 缺任何一个，覆盖面就不成立。
2. **发布态不变量**：`dsh.bundle.patch` 在不在、`private` 设没设、`engines.dsh` 声明了没有、
   `files` 带不带 `cordis.patch.yml`、LICENSE 在不在 —— 这些此前只写在
   [PUBLISHING.md](../../docs/PUBLISHING.md) 的前置条件里（散文）。规则住在散文里就没人执行
   （同类反例：锁文件官方源那条，在 balance 拖成了 129/131 镜像）。

## 决策

照 balance 的做法补齐，顺序保证不红：

1. **先加开关**（`tsconfig.json` 四行），跑 `npm run typecheck` 与 `tsc -p tsconfig.json --noEmit`
   —— 全部 **0 error**（client / test 两个 project 都 extends 根，一处生效三处）。
2. **再加断言**（`test/redlines.test.ts` 新增 `类型检查开关` 组），照 balance `redlines.test.ts`
   的同款写法（含 `stripComments`，防注释里的字样误触发）。
3. **发布态守卫**：新建 `scripts/check-release.mjs`（五条不变量，与 balance 同一批），
   挂 `npm run check:release`，并在 [release.yml](../../.github/workflows/release.yml)
   `npm test` 之后、bump 之前跑 —— 与 balance 的 `release.yml:68` 对齐。

## 替代方案（不采用）

- **只加开关不加断言**：开关会被下次"清理 tsconfig"顺手删掉而没有声音 —— 这正是它的价值所在。
- **自己发明一套检查字段**：balance 那五条已经过一轮实战（它就是从"发布态出过岔子"长出来的），
  对齐它而不是重想。
- **把四开关写进 eslint 配置**：本仓没有 linter，引入 linter 是另一个（已否决的）决定。

## 影响

- 日常无感：四开关只是把 tsc 的检查面补齐，typecheck / test 全绿。
- 发版多一步 `check:release`（秒级）。
- 下限没动、依赖没动、对外行为零变化 —— 按 PUBLISHING 的问题链，这属于
  「零行为变更不发版」的那一类（测试 / 工具 / 文档），不发版。
