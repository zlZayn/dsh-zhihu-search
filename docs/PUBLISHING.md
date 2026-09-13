# dsh-zhihu-search 发布说明

发布前必读。不变的设计约束归 [ARCHITECTURE.md](ARCHITECTURE.md)，日常命令与验证快照归 [AGENTS.md](../AGENTS.md)。

## 发版前确认

只列需要人判断的项；构建、测试、两处版本号一致、工作区状态由工作流自己保证。

1. 档位已按下方[版本号](#版本号)的问题链定好，**major 必须人类确认**。
2. `README.md` 与 `README_en.md` 的安装与配置说明与当前行为一致（两份必同改，见 [AGENTS.md](../AGENTS.md) 的全局规则）。
3. `cordis.patch.yml` 里**不含**任何凭据。

## 发版

发版只有一个入口：手动触发 [release.yml](../.github/workflows/release.yml)。

```bash
gh workflow run release.yml -f tier=patch    # 或 Actions → Release → Run workflow
```

一次运行按顺序做完：校验触发分支是 `main` → `npm ci` / typecheck / test → 拦两处版本号漂移 → `npm version <tier> --no-git-tag-version`（同时写两处）→ 提交 `chore: release vX.Y.Z` → `npm publish` → 推 `main` → `gh release create`（建 tag 与 GitHub Release，说明由 `--generate-notes` 依提交历史生成）。

四条设计约束：

- **先发布、后动远端**：publish 失败时远端不发生任何变化，tag 与 Release 也只可能在发布成功后创建。
- **幂等**：目标版本已在 npm 上时跳过 publish，只补齐 git 侧 —— 重跑一次即可修复「已发布但推送失败」的中断。
- **手工推 tag 不会发布**：tag 由工作流创建，绕过上面的顺序没有意义。
- **档位由人给**：`tier` 是入参，不从 commit 类型推断。

## 版本号

按 SemVer 定档。判据是**原则加判定链**，不是清单：新情况按问题链推，不靠枚举命中。

### 使用者

所有判定都对着使用者问，先确认谁在依赖这个包：

- **模型**：读工具名、工具描述、参数 schema、返回文本。
- **人类使用者**：读设置卡片、README、安装命令、环境变量名、npm 页面元数据。
- **下游代码**：依赖包导出、`peerDependencies`、Node 与 DSH 的版本要求。
- **不算使用者**：CI、测试、`docs/`、[.agents/](../.agents/) —— 它们不进入发布产物。

### 三档原则

- **major**：使用者在旧版上**正确的用法**，升级后会出错或失败。
- **minor**：使用者旧用法**全部仍然正确**，且能观察到新能力。
- **patch**：使用者旧用法**全部仍然正确**，且观察不到新能力 —— 只是更正确、更快或更清楚。

### 判定问题链

按顺序问，**第一个「是」即定档**：

- **Q0**：改动是否进入发布产物（[package.json](../package.json) 的 `files` 清单内）？否 → 不发版，结束。
- **Q1**：是否存在「在旧版上行为正确」的使用者，升级后行为变错或失败？是 → major。
- **Q2**：使用者是否必须改变自己的用法（调用、配置或依赖声明）才能继续正确工作？是 → major。
- **Q3**：使用者能否观察到「以前做不到的事现在能做到」？是 → minor。
- 全否 → patch。

### 判例库

本项目真实判例，每条注明套用哪一问。**只增不删**；与问题链冲突时以问题链为准，并把该条标注为「已 supersede」。

- 只动 `docs/`、`test/`、CI、[.agents/](../.agents/) → Q0 否 → 不发版，搭下次发布的车。
- 源码注释随 `lib/types.d.ts` 进入产物 → Q0 是 → 按性质定档，通常 patch。
- 删除编造值（内容类型兜底成「回答」、点赞数缺失时假报 0）→ Q1 否（没有人能正确依赖一个编造值）→ patch。
- 输出 schema **收紧**（改名字、换类型、删字段、可选变必填）→ Q2 是 → major。
- 参数改名或删除 → Q2 是 → major。
- `peerDependencies` 大版本升级 → Q2 是 → major。
- 输出 schema **放宽**（字段变可选、允许省略值）→ Q1 否 Q2 否 → patch。
- 新增可选参数、新工具、新配置项、设置卡片新能力 → Q3 是 → minor。
- 重写工具描述让模型更容易择路（描述本身没错）→ Q3 是 → minor。
- 工具描述纯纠错（去掉一句做不到的承诺）→ Q1 否 Q3 否 → patch；描述随新能力一起更新 → 随该能力的档位。
- 补上端点本来就有、只是没透出的信号 → Q3 否（不是新能力）→ patch。
- 调整打包清单（排除 source map、补进英文 README）→ Q1 否 Q3 否 → patch。
- 包元数据纠错（`keywords`、npm 页面描述）→ Q1 否 Q3 否 → patch。
- 更新截图与 README 展示 → Q1 否 Q3 否 → patch。

### 兜底与升级条款

- 问题链判不出的新情况：按**不破坏**假设往低档归（patch 或 minor）。在 [.agents/notes/](../.agents/notes/) 写决策记录，并提议是否扩展问题链 —— **不停下来等人类**。
- 唯一例外：判定落在 **major 时必须人类确认** —— major 是对使用者的不可逆承诺。
- 判例库与问题链冲突：以问题链为准，并给该判例标注「已 supersede」。

## 打包内容

发布内容由 [package.json](../package.json) 的 `files` 决定，**以它为准，本文不复制清单** —— 复制的清单会漂移，已经漏过一次 `README_en.md`。

三处需要解释，其余自明：

- `lib/**/*.map` 被排除：这些 source map 指向未随包的 `src/`，对使用者是悬空的，却占了三分之一体积。tsconfig 仍生成它们，本地调试照常。
- `README_en.md` 必须随包：`README.md` 顶部链接指向它，不随包就是 npm 页面上的死链。
- `scripts/` 与 `src/` 不发布，因此 `npm run build` 必须在打包前跑过，`lib/` 是唯一交付物。

校验：

```bash
npm run build
npm pack --dry-run
```

## 构建链的两个事实

- 浏览器半体由 [scripts/build-client.mjs](../scripts/build-client.mjs) 用 esbuild 打成 DSH 的 lazy-CJS 工厂信封。
  官方生成该信封的预设 `clientBundle` 位于 DSH 仓库内 `packages/client/tsdown.client.ts`，**未发布到 npm**，
  所以本包自行复现 —— DSH 升级时需要回归 `test/client-bundle.test.ts`。
- 浏览器半体只允许值导入 `PLATFORM_MODULES` 里列出的模块（DSH `packages/client/web/src/platform.ts`）。
  超出该清单必须同时声明 `dsh.client.inject` 与 `dsh.client.external`。

## 认证与发布

### 主路径：Trusted Publishing（OIDC）

工作流声明 `id-token: write` 与 `environment: github-release`，npm CLI 据此换取短期凭据，**全程不带任何 token**。v1.2.8 即由该路径发布。

一次性配置（npmjs.com → 包 → Settings → Trusted Publisher → GitHub Actions）：

- **Organization or user**：`zlZayn` —— 填 **GitHub 属主**，不是 npm 用户名。
- **Repository**：`dsh-zhihu-search`；**Workflow filename**：`release.yml`（只填文件名，不含路径）。
- **Environment name**：连接上显示的环境名（当前 `github-release`）**必须与 job 的 `environment:` 逐字一致**。
- **Allowed actions**：必须显式勾上 `npm publish` —— 2026-09-03 之后新建的连接默认只给 `npm stage publish`。
- npm 保存时不校验配置，填错只在发布时暴露。

排障：字段不符（属主 / 仓库 / workflow 文件名）通常报 `ENEEDAUTH`；**环境名不符实测报的是 `404 ... you do not have permission to access it`**，极易误读成权限问题 —— 先比对 `environment`，别按权限查。workflow 里的 `Dump the OIDC claims npm validates` 步骤只在发布失败时运行，打印 npm 校验时看到的声明。

时间约束：npm 已于 2026-07-31 收回这类 token 的账户与包管理权限，**2027-01 起收回直接发布**（[公告](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)），故本项目不留长期凭据。

发布稳定后按官方建议收紧：Settings → Publishing access 设为「Require two-factor authentication and disallow tokens」（只影响传统 token，不影响 Trusted Publisher）。

### 备选：本地发布

```bash
npm run build
npm pack --dry-run
npm publish --registry=https://registry.npmjs.org/ --access public
```

账号启用 2FA 而令牌没有 bypass 权限时，本地发布会以 `403` 被拒；此时改用工作流，或加 `--otp=<码>` 人工提供一次性口令。

本地发布不建 tag 与 GitHub Release：补 tag 走工作流重跑（幂等，不会重复发布），不要手工打 tag。

### 前置条件

- `package.json` 的 `repository.url` 必须指向真实仓库，否则 npm 拒绝 provenance 或页面上没有源链接。
- 所有 `@deepseek-ai/*` 保持在 `peerDependencies` 与 `devDependencies`，**不得**进 `dependencies` —— 见 [ARCHITECTURE.md](ARCHITECTURE.md) 的「不可破坏的约束」。
- `package-lock.json` 的 `resolved` 必须指向 `registry.npmjs.org`。锁文件若由国内镜像生成，CI 会去镜像取包（供应链隐患），且 `npm ci` 可能因 peer 未同步而失败。

## CI

- [ci.yml](../.github/workflows/ci.yml)：推 `main` 与每个 PR 跑 typecheck + test。
- [release.yml](../.github/workflows/release.yml)：手动触发，一次跑完[发版](#发版)全流程。

两者都用 `npm ci`：它严格按锁文件安装，锁文件与 `package.json` 不同步时直接失败 —— 这是我们要在 CI 里拦下的情况。

两者都校验 `package.json` 与 `package-lock.json` 的**版本号**一致：ci.yml 在每次推送就拦，release.yml 在 bump 之前再拦一次。版本号写两处，漏一处不该等到发版才发现。

发版提交由 `GITHUB_TOKEN` 推送，因此不会再触发一轮 ci.yml；发布工作流自身已跑过 typecheck 与 test。

## 兼容性

- 宿主版本以 [package.json](../package.json) 的 `peerDependencies` 为准。依赖的是 DSH 的**运行时行为**：`settings.installSection`、`role('secret')` 脱敏、
  `settings.plugin.item` 的分派规则、客户端模块格式。任一处改动都可能在升级后静默失效（卡片不显示或密钥读不到）。
- 判断依据始终以 DSH 源码为准，不凭文档推断。
- 已知缺口见 [AGENTS.md](../AGENTS.md) 的待办。
