# dsh-zhihu-search 发布说明

发布前必读。不变的设计约束归 [ARCHITECTURE.md](ARCHITECTURE.md)，日常命令与验证快照归 [AGENTS.md](../AGENTS.md)。

## 发版前确认

只列需要人判断的项；构建、测试、两处版本号一致、工作区状态由工作流自己保证。

1. 档位按下方[版本号](#版本号)的问题链定：**patch / minor 由维护 agent 定档后直接发，major 必须先经人类确认**。
2. `README.md` 与 `README_en.md` 的安装与配置说明与当前行为一致（两份必同改，见 [AGENTS.md](../AGENTS.md) 的全局规则）。
3. `cordis.patch.yml` 里**不含**任何凭据。

## 发版

发版只有一个入口：手动触发 [release.yml](../.github/workflows/release.yml)。

```bash
gh workflow run release.yml -f tier=patch    # 或 Actions → Release → Run workflow
```

一次运行按顺序做完：校验触发分支是 `main` → **守卫**（[`scripts/release-guard.mjs`](../scripts/release-guard.mjs)：上个 tag 以来没有产物改动就直接红）→ `npm ci` / typecheck / test → 拦两处版本号漂移 → `npm version <tier> --no-git-tag-version`（同时写两处）→ 提交 `chore: release vX.Y.Z` → `npm publish` → 推 `main` → `gh release create`（建 tag 与 GitHub Release，说明由 `--generate-notes` 依提交历史生成）。

五条设计约束：

- **先发布、后动远端**：publish 失败时远端不发生任何变化，tag 与 Release 也只可能在发布成功后创建。
- **幂等**：目标版本已在 npm 上时跳过 publish，只补齐 git 侧 —— 重跑一次即可修复「已发布但推送失败」的中断。
- **手工推 tag 不会发布**：tag 由工作流创建，绕过上面的顺序没有意义。
- **档位由判定链定**：`tier` 是入参，不从 commit 类型推断；patch / minor 由维护 agent 直接发，major 需人类确认。
- **不发无行为变更的版本**：bump 之前先比「上个 tag..HEAD」的改动清单，只剩非产物改动就红；`force` 是唯一的越过方式，且要说明理由。

## 发布后才发现严重缺陷

顺序固定，四步都要做：

1. **修 → 发 patch**（档位按[版本号](#版本号)的问题链定；修已发布缺陷一般是 patch）。
2. **`npm deprecate` 坏版本**：`npm deprecate "包名@<版本>" "<一句人话的原因 + 该升级到哪>" --registry=https://registry.npmjs.org/`。
3. **改坏版本的 GitHub Release 说明**：顶部加 `> [!WARNING]`，写清症状与替代版本 —— Release 说明是唯一能在「已经发出去之后」补充的对外面。
4. **新版本的 Release 说明也要说明它修了什么**：`--generate-notes` 只抄提交标题，标题未必自带结论。

三条边界：

- **`deprecate` 是警告不是拦截**：精确指定版本或 lockfile 钉住的安装**照样装上**，只多一行提示。真正拦住正常路径的是 `latest` 指向修好的版本。
- **不 unpublish**：撤版本会让钉住它的安装直接失败，也破坏可复现性。已发出的产物就当它存在。
- **`deprecate` 没有 OIDC 通道**：Trusted Publishing 只覆盖 `npm publish`，所以这一步**必须人工带 2FA 在本地做**，加进 [release.yml](../.github/workflows/release.yml) 也没用。仓库的 npm 侧设了「Require 2FA and disallow bypass-2FA tokens」，自动化凭据一律不可用。

判例：1.3.0（开关静默无效）、1.4.0（两个搜索工具整体失败）、1.6.0（卡片装不上）、1.6.1（工具无密钥）四个版本已按此标掉；理由与证据见 [docs/postmortem/](postmortem/)。

## 版本号

按 SemVer 定档。判据是**原则加判定链**，不是清单：新情况按问题链推，不靠枚举命中。

### 使用者

所有判定都对着使用者问，先确认谁在依赖这个包：

- **模型**：读工具名、工具描述、参数 schema、返回文本。
- **人类使用者**：读插件配置卡片、README、安装命令、环境变量名、npm 页面元数据。
- **下游代码**：依赖包导出、`peerDependencies`、Node 与 DSH 的版本要求。
- **不算使用者**：CI、测试、`docs/`、[.agents/](../.agents/) —— 它们不进入发布产物。

### 三档原则

- **major**：使用者在旧版上**正确的用法**，升级后会出错或失败。
- **minor**：使用者旧用法**全部仍然正确**，且能观察到新能力。
- **patch**：使用者旧用法**全部仍然正确**，且观察不到新能力 —— 只是更正确、更快或更清楚。

### 判定问题链

按顺序问，**第一个「是」即定档**：

- **Q0**：改动是否改变**已发布产物的行为**（工具参数与描述、渲染文本、配置、导出面、构建产物）？否 → **不发版**，改动搭下次发布的车。
  - 判据是**行为**，不是文件路径：纯文档 / 测试 / CI / 工具脚本，以及**行为等价的内部重构**（端点常量换来源、改名、等价重写）都属于「否」。
  - 机器只判得了一半：`scripts/release-guard.mjs` 按路径拦下「上个 tag 以来全是非产物改动」的区间（见[发版](#发版)）；行为等价的重构它看不出，由回答 Q0 的人或 agent 负责。
- **Q1**：是否存在「在旧版上行为正确」的使用者，升级后行为变错或失败？是 → major。
- **Q2**：使用者是否必须改变自己的用法（调用、配置或依赖声明）才能继续正确工作？是 → major。
- **Q3**：使用者能否观察到「以前做不到的事现在能做到」？是 → minor。
- 全否 → patch。

### 判例库

本项目真实判例，每条注明套用哪一问。**只增不删**；与问题链冲突时以问题链为准，并把该条标注为「已 supersede」。

- 只动 `docs/`、`test/`、CI、[.agents/](../.agents/) → Q0 否 → 不发版，搭下次发布的车。
- ~~源码注释随 `lib/types.d.ts` 进入产物 → Q0 是 → patch~~ **已 supersede**：注释不构成行为，按现行 Q0 归「否」→ 不发版。
- 纯文档 / 测试 / CI / 工具脚本改动 → Q0 否 → **不发版**；`release-guard.mjs` 会直接拦下，确需发版时勾 `force`。
- 行为等价的内部重构（端点常量换来源、函数改名、等价重写）→ Q0 否 → **不发版**；守卫按路径判不出这类改动，靠 Q0 回答。
- 删除编造值（内容类型兜底成「回答」、点赞数缺失时假报 0）→ Q1 否（没有人能正确依赖一个编造值）→ patch。
- 输出 schema **收紧**（改名字、换类型、删字段、可选变必填）→ Q2 是 → major。
- 参数改名或删除 → Q2 是 → major。
- `peerDependencies` 大版本升级 → Q2 是 → major。
- 输出 schema **放宽**（字段变可选、允许省略值）→ Q1 否 Q2 否 → patch。
- 新增可选参数、新工具、新配置项、配置卡片新能力 → Q3 是 → minor。
- 重写工具描述让模型更容易择路（描述本身没错）→ Q3 是 → minor。
- 工具描述纯纠错（去掉一句做不到的承诺）→ Q1 否 Q3 否 → patch；描述随新能力一起更新 → 随该能力的档位。
- 补上端点本来就有、只是没透出的信号 → Q3 否（不是新能力）→ patch。
- 调整打包清单（排除 source map、补进英文 README）→ Q1 否 Q3 否 → patch。
- 包元数据纠错（`keywords`、npm 页面描述）→ Q1 否 Q3 否 → patch。
- 更新截图与 README 展示 → Q1 否 Q3 否 → patch —— 这是**搭车时的档位**，不是「为图发版」：`assets/` 与 `.md` 都不进产物，只含它们的区间会被[守卫](../scripts/release-guard.mjs)拦下，重截图随引起它的那次改动一起走（判例 `d0a3adb` 搭了 v1.4.0）。
- 新增可选开关（如「隐藏原生网页搜索」）→ 旧用法全部仍然正确，且能观察到新能力 → Q3 是 → minor。
- 修复已发布功能里的逻辑缺陷（开关存了却不生效）→ 旧用法仍正确、只是真的开始工作 → Q1 否 Q3 否 → patch。
- 补上漏声明的输出 schema 字段（宿主按 `additionalProperties: false` 校验，漏一处工具整体失败）→ 修复已发布缺陷 → patch；**发布后才发现**的回归另记[复盘](postmortem/2026-09-14-output-schema-drift.md)。
- 把密钥从设置字面量迁到凭据存储（启动期自动迁徙 + 卡片改走 `remote.credentials`）→ Q1 否（旧用法自动搬走，仍正确）Q3 是（密钥不再落 `settings.yaml`、徽标改问凭据域、只读遮蔽可见）→ **minor**。理由见[决策记录](../.agents/notes/2026-09-15-credential-store-migration.md)。2026-09-22 补记：迁徙此后只剩**组合配置**一条来源 —— 旧 `settings.yaml` 那半边随这次设置接缝换代（2026-09-22）一起消失（宿主按 section 名导入且只映射官方 section，结构上到不了本插件）。
- **Q1 的边界：新增对某个平台服务的硬依赖**，若标准装配必然提供它、且依赖它的那一边在不满足时**整体不工作**（而不是退化成错误行为）→ 不算 Q1 的破坏。上一条即此例：`remote.credentials` 是官方 web 装配的必备件，缺它时新版卡片本就不工作，旧用法谈不上「变错」。前提不成立时（标准装配不保证提供该服务）仍按 Q1 判 major。
- 修 v1.6.0 的卡片加载失败（`inject` 漏声明 `remote`，属性访问抛 `without inject`）→ 没有人**正确**的用法因此变错，也没有新能力 → Q1 否 Q3 否 → **patch**；**发布后才发现**的回归另记[复盘](postmortem/2026-09-15-client-inject-remote-missing.md)。
- 修 v1.6.0/v1.6.1 的工具「没有 key」与迁徙失效（`ctx.get('credentials')` 在线上装配里拿不到服务）→ 同理，旧用法不会因此变错，只是真的开始工作 → **patch**；发布后才发现 → [复盘](postmortem/2026-09-15-credential-service-unreachable.md)。

### 兜底与升级条款

- 问题链判不出的新情况：按**不破坏**假设往低档归（patch 或 minor）。在 [.agents/notes/](../.agents/notes/) 写决策记录，并提议是否扩展问题链 —— **不停下来等人类**。
- 唯一例外：判定落在 **major 时必须人类确认** —— major 是对使用者的不可逆承诺。
- 判例库与问题链冲突：以问题链为准，并给该判例标注「已 supersede」。

## 打包内容

发布内容由 [package.json](../package.json) 的 `files` 决定，**以它为准，本文不复制清单** —— 复制的清单会漂移，已经漏过一次 `README_en.md`。

四处需要解释，其余自明：

- `lib/**/*.map` 被排除：这些 source map 指向未随包的 `src/`，对使用者是悬空的，却占了三分之一体积。tsconfig 仍生成它们，本地调试照常。
- `README_en.md` 必须随包：`README.md` 顶部链接指向它，不随包就是 npm 页面上的死链。
- `scripts/` 与 `src/` 不发布，因此 `npm run build` 必须在打包前跑过，`lib/` 是唯一交付物。
- `assets/` **不必**进包：npm 页面会把 README 里的相对图片路径改写到默认分支的 raw 地址（实测形态：`raw.githubusercontent.com/zlZayn/dsh-zhihu-search/HEAD/<仓库相对路径>`，按仓库里的原始尺寸渲染）。代价是**所有已发布版本的页面都跟着 `main` 上的图走** —— 换图或删图等于同时改历史版本的展示。

校验：

```bash
npm run build
npm pack --dry-run
```

需要证明 npm 上的产物与本地已验证的一致时：下载该版本的 tarball、解包，与仓库 `lib/` 逐文件比对 SHA-256 —— 一致即「发布产物 == 已验证产物」。
不必对裸包再跑一遍验收：包的 peer 依赖由宿主提供，裸包本来就跑不起来。

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

包的 Publishing access 已设为「Require two-factor authentication and disallow bypass-2FA tokens」：传统凭据一律不可用，发布只剩 OIDC 这一条路（该设置不影响 Trusted Publisher）。

### 备选：本地发布

```bash
npm run build
npm pack --dry-run
npm publish --registry=https://registry.npmjs.org/ --access public
```

本地发布只能靠交互式 2FA（`--otp=<码>`）：包已禁止 bypass-2FA 凭据，所以本地发布**无法**用 token 自动化 —— 要无人值守就只能是工作流。

本地发布不建 tag 与 GitHub Release：补 tag 走工作流重跑（幂等，不会重复发布），不要手工打 tag。

### 前置条件

- `package.json` 的 `repository.url` 必须指向真实仓库，否则 npm 拒绝 provenance 或页面上没有源链接。
- 所有 `@deepseek-ai/*` 保持在 `peerDependencies` 与 `devDependencies`，**不得**进 `dependencies` —— 见 [ARCHITECTURE.md](ARCHITECTURE.md) 的「不可破坏的约束」。
- `package-lock.json` 的 `resolved` 必须指向 `registry.npmjs.org`。锁文件若由国内镜像生成，CI 会去镜像取包（供应链隐患），且 `npm ci` 可能因 peer 未同步而失败。**这条已落成红线**（[test/redlines.test.ts](../test/redlines.test.ts) 的「锁文件」组）—— 别再靠人核对。
- **发布态不变量**（`dsh.bundle.patch` 在、`private` 未设、`engines.dsh` 已声明、`files` 含 `cordis.patch.yml`、LICENSE 在）已落成脚本 `npm run check:release`，[release.yml](../.github/workflows/release.yml) 发布前自动跑 —— 别再靠人核对这一节。
- 依赖变更后用 `npm install --registry=https://registry.npmjs.org/` 重建锁文件：本地用 `--legacy-peer-deps` 安装会让 `package-lock.json` 缺自动 peer，`npm ci` 随即失败。

## CI

- [ci.yml](../.github/workflows/ci.yml)：推 `main` 与每个 PR 跑 typecheck + test。
- [release.yml](../.github/workflows/release.yml)：手动触发，一次跑完[发版](#发版)全流程。
- [contract.yml](../.github/workflows/contract.yml)：每周一 01:00 UTC 盯**知乎开放平台**的行为指纹。
- [compat.yml](../.github/workflows/compat.yml)：每周一 02:00 UTC 盯**宿主 DSH** 的版本线，见[兼容性](#兼容性)。
  与 contract.yml 同构、分工不同：两条上游各自会悄悄漂移，时间错开是为了红了能分清是谁漂了。

两者都用 `npm ci`：它严格按锁文件安装，锁文件与 `package.json` 不同步时直接失败 —— 这是我们要在 CI 里拦下的情况。

两者都校验 `package.json` 与 `package-lock.json` 的**版本号**一致：ci.yml 在每次推送就拦，release.yml 在 bump 之前再拦一次。版本号写两处，漏一处不该等到发版才发现。

发版提交由 `GITHUB_TOKEN` 推送，因此不会再触发一轮 ci.yml；发布工作流自身已跑过 typecheck 与 test。

- 两份 workflow 的 action 均已升 v7：v7 移除了 dummy `NODE_AUTH_TOKEN` 兜底（`.npmrc` 引用 `${NODE_AUTH_TOKEN}`，而 `npm ci` 跑在带真 token 的 `npm publish` 之前）—— 2026-09-13 在 PR 分支用 `workflow_dispatch` 实跑验证过，无需为它退回 v4。
- action 版本漂移交给 [dependabot.yml](../.github/dependabot.yml)（每周一个 bump PR）。**PR 上的 CI 只跑 ci.yml：动 `release.yml` 的 PR 就算绿勾也不代表发布链路验过** —— 改发布链必须手动 dispatch 实跑。

## 兼容性

**声明面**只有一个事实来源：[package.json](../package.json) 的 `engines.dsh` 与 `peerDependencies`（两处形状必须一致，由 [test/redlines.test.ts](../test/redlines.test.ts) 断言）。依赖的是 DSH 的**运行时行为**：`schema.volatile()` 的活引用语义（`.get()`）、**只有 volatile 字段进配置页**、`settings.configure({ auto: false }, fiber)`、`ctx.on('loader/volatile-update', …)`、`role('secret')` 脱敏、**`ctx.inject` 的属性访问语义**（不是 `ctx.get`）、`remote.credentials` 的 `describe`/`set`、`plugins.bundle.config` 的 keyed 分派（key = 包名，且**该槽不传 `form`**）、客户端服务 `ctx.configForms` 的 `get`/`getSnapshot`/`subscribe`/`mutate`、客户端模块格式。任一处改动都可能在升级后静默失效（卡片不显示、开关不生效、密钥读不到）。判断依据始终以 DSH 源码为准，不凭文档推断。

**验证面**是 [compat.yml](../.github/workflows/compat.yml)。声明与验证必须对齐 —— 改动任意一边都要同步另一边。

### dist-tag 是唯一可用的锚点

DSH 至今全是 prerelease，版本号本身不构成承诺，tag 才是。三个 tag 语义**各不相同**（`@deepseek-ai/dsh-*` 全家族一致）：

| tag | 含义 | compat.yml 怎么用 |
| --- | --- | --- |
| `alpha` | **当前承诺线**：声明面（`engines.dsh` + 27 条 DSH 依赖）落在这一条上 | 换包 + 跑全套；红了**必须修**（run 红） |
| `next` | **已低于本仓声明的下限** | 换包 + 跑全套；红了**只记录**（job 红、run 绿） |
| `latest` | **不可用** | 不碰 |

**2026-09-22 两个 job 的角色对调了**（此前 next 承诺、alpha 前瞻）。理由不是口味：本仓的配置接缝只存在于 alpha 线上 —— 接缝换代之前 `next` 线上没有 `configForms` 那套配置面（卡片因此拿不到表单），声明面只能跟着 alpha 走。而一条**长期必红**的周更任务会让「红 = 出事」这个信号失效，所以判断哪条线是承诺线，判据是「声明面落在哪」，不是历史习惯。

`latest` 为什么不可用：多数 `@deepseek-ai/dsh-*` 包上它指向很早的版本，`@deepseek-ai/dsh` 自己那条也未必落在本插件的声明区间里 —— 逐包对照现查 `node scripts/compat-swap.mjs check latest`（`check` 收任意 dist-tag），宿主自己那条线现查 `npm view @deepseek-ai/dsh dist-tags`。按默认方式装宿主的人会落在声明范围之外，所以 [README](../README.md) 的前置版本必须写明装哪条线。

### 红了怎么办（按线分流）

**`alpha` 红 = 使用者会装到，必须修。**先判类别，三类处理完全不同：

- **换包或核对步骤失败** → 树根本没换成，先解决安装问题再看别的（多半是上游包之间的 peer 冲突）。这一条不能省：旧版本的树会让后面每一步都绿，报出一个**假兼容**。
- **类型面红** → 上游 API 签名变了。定位到具体包与符号，改调用点使其**新旧都能编译**；做不到就说明下限必须抬高，那是 Q2 是 → **major，先问人类**。
- **全量测试红** → **行为差异**，最重。按 [test/README.md](../test/README.md) 的分层定位：L3b/L6a 红说明平台语义变了，L1/L2 红则先怀疑换包装错了（那几层对宿主版本不敏感）。

**`next` 红 = 记录，不阻断。**它已低于本仓声明的下限，换上去等于把依赖降到声明范围之外，红了通常只说明旧线上装不出新接缝 —— 那是**预期**，不是缺陷。这一类的价值只剩「旧线哪一步先坏」这份记录；不要按它去放宽声明（那会把使用者引到我们不再声明的线上）。

### 声明面变动要同步的地方

- `peerDependencies` 的区间 → [README.md](../README.md) 与 [README_en.md](../README_en.md) 的「前置」版本（两份必同改）。
- `engines.dsh` 的区间 → 两份 README 的「版本兼容」章节（那份章节只指真源，不抄版本）：它声明的是**实际验证过的最低宿主版本**与**排除下一个大版本的上界**。
- **`engines.dsh` 与全部 27 条 `@deepseek-ai/dsh-*` 声明形状必须一致**（2026-09-22 起：同一条区间字符串）→ 由 [test/redlines.test.ts](../test/redlines.test.ts) 的「声明面自洽」一组断言；改一处就要改全部，否则使用者按我们给的区间装出来的宿主可能没有本插件赖以工作的接缝。
- [scripts/compat-swap.mjs](../scripts/compat-swap.mjs) 的换包写回是**保形**的：只替换区间里的下限版本，比较符与上界原样留下。别改成 `'^' + version` 那种硬编码 —— 它会把声明面在 CI 里悄悄变形，而人只看到 job 绿。
- 声明面与「README 让用户去装的那条线」由 [compat.yml](../.github/workflows/compat.yml) 的 `declaration` 作业对账：它红了就是声明面落后，失败会开一条固定标题的跟踪 issue。**它只查承诺线（alpha）** —— 查一条我们不再声明的线，红只会变成每周的噪音。
- 区间放宽本身不改行为（旧用法仍正确，只是允许更新的宿主）→ 按[版本号](#版本号)的 Q1/Q2 全否 → **patch**；但**必须发版**，声明在产物里。
- 已知缺口与待办见 [AGENTS.md](../AGENTS.md)。
