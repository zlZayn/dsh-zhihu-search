# 决策：发版收敛为单一手动入口，认证迁到 Trusted Publishing（2026-09-14）

已实施：`release.yml` 改为 `workflow_dispatch` 单一入口，一次运行跑完 bump → 发布 → tag → GitHub Release。

## 问题

手工发版要人对齐四个动作（bump 两处版本、提交、打 tag、发布），实测已经漂移：`v1.2.7` 的 tag 落在 bump 提交之后的 `64f5c43`，而 GitHub Releases 至今为空。

同时 npm 在收紧凭据：bypass-2FA 的 Granular token 已于 2026-07-31 失去账户与包管理权限，**2027-01 起将失去直接发布**（[公告](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)）。

## 决策

- 发版只有一个入口：`gh workflow run release.yml -f tier=patch|minor|major`。
- 顺序全有或全无：先发布成功，才推 `main`、才建 tag 与 Release。
- 幂等：目标版本已在 npm 上时跳过 publish，只补齐 git 侧，用于修复中断的运行。
- 档位仍由人按 [docs/PUBLISHING.md](../../docs/PUBLISHING.md) 的问题链选定，major 需人类确认。
- 认证走 Trusted Publishing（OIDC）；`NPM_TOKEN` 仅作过渡期回退，验证通过后吊销。
- 发布命令留在 `release.yml` 这个文件名里：OIDC 按 workflow 文件名校验，换成别的文件名或包一层 `workflow_call` 都会对不上。

## 替代方案（强制）

- **release-please（release PR 模式）**：它用 `GITHUB_TOKEN` 打的 tag 不会触发其他工作流（GitHub 防递归），必须再引入 PAT 或 GitHub App，与去 token 的方向相反；档位由 commit 类型推断，与本项目 Q0–Q3 判定链冲突；还会自动维护 `CHANGELOG.md`，而维护约定是「仅在明确要求时创建」。
- **semantic-release（合进 main 就发）**：与「major 必须人类确认」直接冲突。
- **保留 `push: tags` 触发**：手工 tag 与工作流 tag 形成两个真相源，且绕过「先发布后推送」的顺序。
- **staged publishing（只暂存，人工 2FA 批准）**：安全性最高，但每次发版多一次人工批准，与「一气呵成」冲突；留作后续可选收紧项。

## 影响

- 版本、tag、Release、npm 四者在一次运行内同步，不再有漂移空间。
- 发布提交由 `GITHUB_TOKEN` 推送，不会再触发一轮 CI；发布工作流自身已跑 typecheck 与 test。
- 未决：Trusted Publisher 需在 npmjs.com 手动配置一次（步骤见 [docs/PUBLISHING.md](../../docs/PUBLISHING.md)），验证通过后吊销 `NPM_TOKEN`。
