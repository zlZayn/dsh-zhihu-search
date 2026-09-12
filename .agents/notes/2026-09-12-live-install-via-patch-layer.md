# 决策：用 patch 层 insert 安装，不走 bundle 列表（2026-09-12）

已实施。

## 问题

插件需要挂进运行中的 DSH profile。标准形态是把包加进 `dsh.profile.bundles` 并依赖其 `dsh.bundle.patch`，
但 bundle 列表**只在启动时读取一次**，改完必须重启 `dsh web`。

而 `dsh web` 正是承载当前会话的进程：Agent 的执行链是
`pwsh ← node(runner) ← node(dsh web)`，重启它会当场终止 Agent 自己，且一旦重启失败维护者会同时失去 GUI 与会话。

## 决策

把插件行直接 `insert` 到 profile 的 `cordis.patch.yml`，并从 `dsh.profile.bundles` 中移除。

依据：profile 的 `patchReload: live` 明确是「user patch-file lifecycle」，patch 文件被监听并热重载；
bundle 列表不在此列。两者只能选一个 —— 同时存在会产生两行同 id。

## 替代方案

- **加进 bundles 后重启**：会在 Agent 报告结果之前杀死自己，且失败即无 GUI 可回滚。
- **同时保留 bundles 与 patch insert**：两行同 id，未验证的行为，不冒这个险。
- **让维护者手动重启**：可行但非必要 —— patch 层本就能热挂载，把可自动完成的事推给人。

## 影响

- 安装即时生效，无需重启。
- 代价：安装形态与另外两个第三方插件（走 bundles）不同，已在 patch 文件里写明理由。
- 包自身的 `dsh.bundle.patch` 保留未删：将来若改为 bundle 安装仍然可用。
- `link:` 安装直接读取 `lib/`，因此改完 `src/` 必须重新 `npm run build` 才生效。
