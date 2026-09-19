# dsh-zhihu-search — 维护索引

## 状态

- 已发布版本以 [package.json](package.json) 的 `version` 为准 → <https://github.com/zlZayn/dsh-zhihu-search>
- npm → <https://www.npmjs.com/package/dsh-zhihu-search>（由 [release.yml](.github/workflows/release.yml) 手动触发，一次跑完 bump → 发布 → tag → GitHub Release）
- 功能、插件页配置卡片与本地真机验证全部完成；工具清单见 [README.md](README.md)。
- 市场收录：仓库已带 `dsh-plugin` topic；`awesome-dsh-plugin` 的 [PR #5037](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5037) 已提，等评审 → [笔记](.agents/notes/2026-09-12-marketplace-submission.md)

## 全局规则

- 结论必须来自实测，不得来自文档推断 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 红线以测试固化，共五条（依赖分层、呈现隔离、模型上下文隔离、无全局状态、模型不见原始语法）→ [test/README.md](test/README.md)
- 对外可见行为变化，同一次改动内同步 [README.md](README.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 改根 [README.md](README.md) 必同改 [README_en.md](README_en.md)，冲突以中文为准
- 「版本兼容」章节只讲分水岭与真源指针，**不抄会漂的宿主版本**；判据：`engines.dsh` 一旦落后于实际部署的宿主线（[compat.yml](.github/workflows/compat.yml) 的 declaration 作业转红即为信号），该章与两份 README 的「前置」必须同批复核
- **声明面应当自洽**：所有 `@deepseek-ai/dsh-*` 声明的下限不该低于 `engines.dsh` 的下限 —— 两份声明矛盾时，使用者按我们给的区间装出来的宿主未必有 `plugins.bundle.config` 槽，而配置面只向该槽注册（落上去配置页**静默不出现**）。**但此刻不能抬**：本仓声明停在 next 线、`engines.dsh` 下限在 alpha 线，而 alpha 线的**类型面已红**（见下面「宿主兼容性」那条），抬上去默认安装会装不出来。**触发条件与尝试记录见[决策记录](.agents/notes/2026-09-20-declaration-floor-stays-on-next.md)**
- **只做类型面（module augmentation）、运行时由宿主经 `dsh.client.inject` 提供的官方包，只写 `devDependencies`，不写 `peerDependencies`** —— 目前只有 `@deepseek-ai/dsh-client-ui-plugin-manager`，见[决策记录](.agents/notes/2026-09-20-plugin-manager-dependency-kind.md)
- **四个「通用 lint 那一档」的编译器开关代替 linter**（`noUnusedLocals` / `noUnusedParameters` / `noImplicitReturns` / `noFallthroughCasesInSwitch`），缺任何一个覆盖面就不成立 → 由 [test/redlines.test.ts](test/redlines.test.ts) 断言；client / test 两个 project 都 extends 根 `tsconfig.json`，一处生效三处
- **发布态不变量由脚本守卫**（`dsh.bundle.patch` 在、`private` 没设、`engines.dsh` 声明了、`files` 带 `cordis.patch.yml`、LICENSE 在）→ `npm run check:release`，[release.yml](.github/workflows/release.yml) 发布前跑
- 决策理由 → [.agents/notes/](.agents/notes/)
- 发版授权：patch / minor 按 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的问题链定档后**直接发**；**major 必须先问人类**；**零行为变更不发版**（纯文档 / 测试 / CI / 等价重构）

## 事实来源（只查不抄）

- 版本号、依赖、宿主兼容性 → [package.json](package.json)
- 工具参数、默认值与上限 → [src/tools/](src/tools/) 的常量与 [src/transport.ts](src/transport.ts) 的端点契约常量（上限只住后者，工具层取别名），由 [test/tool.test.ts](test/tool.test.ts) 守护
- 端点语法与实测偏差 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 构建产物的运行方式 → [docs/PUBLISHING.md](docs/PUBLISHING.md)
- DSH 平台知识（插件装配、Remote API、设置卡片、i18n、工具契约）→ [DSH cookbook](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/cookbook)，每篇都有 `.zh.md` 中文版
- **有自更新来源的事实一律指向来源**：测试与类型检查 → Actions；发布版本 → npm badge；产物一致性 → 哈希比对（见 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的「打包内容」）。别在本文件留快照数值。

## 常用命令

- `npm run build`（host tsc + client tsc + esbuild）· `npm run typecheck` · `npm test`（先 build 再 vitest）· `npm run test:contract`（打真实接口，需 `ZHIHU_ACCESS_SECRET`，日常 CI 不跑）
- 真机验收：`ZHIHU_ACCESS_SECRET=xxx node scripts/acceptance.mjs [包目录]` —— 默认验 profile 里装的那份，覆盖真实接口 + 宿主 schema 校验 + 渲染文本，见 [scripts/README.md](scripts/README.md)
- 发版：`gh workflow run release.yml -f tier=patch|minor|major` —— 唯一入口，档位按 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的问题链定；无行为变更时 [守卫](scripts/release-guard.mjs) 会拦下（`-f force=true` 才能越过）
- 兼容性换包（本地复现 [compat.yml](.github/workflows/compat.yml)）：`node scripts/compat-swap.mjs swap next` → `npm install --ignore-scripts` → `node scripts/compat-swap.mjs verify next`。**它会改写 `package.json`**，只在一次性 clone 里跑；声明面单独查用 `check next`

## 验证快照（2026-09-16 实跑）

数字与版本一律看自更新来源（理由见「[文档网络与自更新](#文档网络与自更新)」）：测试与类型检查 → [Actions](https://github.com/zlZayn/dsh-zhihu-search/actions)，发布版本 → [npm](https://www.npmjs.com/package/dsh-zhihu-search)。下面只记不随数字漂移的定性结论；更早轮次的真机验证见 [.agents/notes/](.agents/notes/) 与 `git log`。

- 契约测试：本机与 GitHub Actions 都实跑通过（后者由 repo secret `ZHIHU_ACCESS_SECRET` 供燃料）；每周一由 [contract.yml](.github/workflows/contract.yml) 跑；日常 `npm test` 不含 live 探针，只多一份底座的离线自检
- 真机验收：[scripts/acceptance.mjs](scripts/acceptance.mjs) 覆盖扩池 / 输出对称 / www 归一化 + 宿主 schema 校验 + 渲染文本；升级 + host 重启后在 profile 安装副本上跑通，工具面同参数复验一致
- 发版守卫：只有文档 / 工具脚本改动的区间在 `npm ci` 之前被拦下（后续步骤全 skipped，npm 侧零动作）；含 `src/` 的区间正常放行
- 诚实渲染：到顶必说 / 来源构成分流 / 空态首句条件限定由 [test/presentation.test.ts](test/presentation.test.ts) 固化；`count` 回满上限不额外提示（刻意防噪音）
- 宿主兼容性：由 [compat.yml](.github/workflows/compat.yml) 每周对 `next`（承诺线）与 `alpha`（前瞻线）换包，跑的是现有套件、不写新测试；结论与处理链归 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的「兼容性」。这里只留定性结论：**类型面会先于行为面动** —— alpha 线上类型面已红而 260 个测试全绿，所以「测试全绿」不能当作「兼容」的结论
- 明文迁徙：**真机跑通**（2026-09-16）—— 装入 1.6.2 + 重启 host 后，`settings.yaml` 的 `zhihu-search:` 段只剩 `disableNativeWebSearch`，值（40 位十六进制、与原明文逐字一致）落进 `.credentials.yaml` 的 `refs`，两个文件同一秒被改写。此前在 `lib/` 产物 + 真实 provider + 本机 `settings.yaml` **副本**上也跑通过（段内清理、其他 section 与注释原样保留、第二次运行是空操作）

## 待办

- 清理旧明文通道：等使用者跨过当前版本后，删 `Config.accessSecret` 与 [src/migrate.ts](src/migrate.ts)（**必须一起删**，理由见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 的「`accessSecret` 为什么仍留在 schema 里」）
- **声明面仍落后于实际部署**（2026-09-20 复核，仍未解）：`engines.dsh` 的下限在 alpha 线，而 `peerDependencies` 与 dev 面共 27 条声明停在 next 线。**这次试过抬上去，抬不动** —— 在 alpha 线上 `npm install` 能装（依赖图解得开），但 `npm run build` 过不了：`tsc` 在 `src/index.ts` 的 `agent/created` handler 上报类型不符，即 alpha 线的**类型面已红**（证据与备份路径见[决策记录](.agents/notes/2026-09-20-declaration-floor-stays-on-next.md)）。所以维持原计划：等 alpha 切到 next（或发正式版）时按 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的「兼容性」放宽范围、同步两份 README，并按 Q1/Q2 定档；放宽时一并定下限 —— **新下限不得低于引入 `plugins.bundle.config` 的那个版本**（`engines.dsh` 现在声明的下限就是它）。
- 处置 `@deepseek-ai/dsh-code-runtime`：`devDependencies` 里**没有任何文件引用它**，且它在 alpha 线上停在一个比 next 线还旧的版本（现查 `node scripts/compat-swap.mjs check latest`）—— 换包脚本因此每个 alpha 轮都要告警跳过它一次。删掉即消失；**它也是上面那条「抬不动」里唯一一个在 alpha 线上连版本都对不上的包**（抬了直接装不出来）
- **npm 上已发布版本的头图会断**：npm 页面按 `main`（HEAD）取 README 里的图，而 v1.6.3 及更早的 README 写的是 `assets/cover.svg` —— 该文件已随头图换新（`banner.svg`）删除。**最新**那页会随下次发版自动修好；更早版本的页面文字在发布时就定死，除非把 `cover.svg` 补回。下次发版后顺手看一眼 npm 页面头图即可

## 活跃坑（工具链与 DSH 平台）

知乎 API 自身的反直觉处归 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；**模块内的坑下放到对应子目录的 `AGENTS.md`**（在那里工作时自动注入），此处只留跨模块、踩了整条链就崩的几条。

- **生效链取决于 profile 怎么挂的，先查再假设**：`Get-Item <profile>\node_modules\dsh-zhihu-search | Select LinkType,Target`。
  - **符号链接到仓库**：`npm run build`（含 `npm test` 的 build）**直接写线上**，`dsh-client-hmr` 轮询 `lib/client.js` 当场换掉**浏览器半体**；host 半体要重启才换。改客户端半体因此免发版即生效，但**构建即上线** —— 没验证过的构建会立刻影响正在用的界面。
  - **普通目录（registry 副本）**：build → 发版 → `dsh plugin --profile web add dsh-zhihu-search@<ver>` → 重启。按版本安装会把链接换成副本，开发环也就断了。
  - 两种模式下 host 半体都只在启动时读，**必重启**；`dsh.profile.bundles` 同理。
- **半体可以错配**：浏览器半体热更、host 半体不热更，两者版本因此可能不一致（一次 build 或一次安装就能造成）。v1.6.0 的卡片回归就是这样暴露的 —— 维护者没装任何东西，仓库里一次 `npm run build` 就把线上浏览器半体换成了带 bug 的构建，而 host 半体仍是旧的（启动期迁徙因此从未执行）。**看到客户端半体报错时，别假设 host 半体是同一个版本。**
- **产物三副本**：改工具输出字段必须**同时**改 Canonical 类型、投影层、`output.schema`；宿主按最后一份校验（`additionalProperties: false`），漏一处 = 整个工具调用失败（v1.4.0 的 P0 → [复盘](docs/postmortem/2026-09-14-output-schema-drift.md)）。
- **DSH scope 机制**：原生网页工具**不在全局层**（住在 agent preset 的 standing scope），判断存在性必须站在 agent scope 上；取注册表只能走**免 inject 的 `agent.ctx.get('tools')`**（属性访问抛 `without inject`）。v1.3.0 因读全局视图而静默失效 → [复盘](docs/postmortem/2026-09-14-hidden-tool-restriction-noop.md)。
- **inject 门禁按服务名逐字判**：`ctx.x` 属性访问要求 `x` **逐字**出现在某个 fiber 的 `inject` 里，点号键**不展开**成父级 —— 声明了 `remote.credentials` **不等于**能访问 `ctx.remote`。同一机制已踩中两次（agent scope 的 `tools`、客户端半体的 `remote`，后者让卡片整块装不上）；碰平台服务先看官方同类插件的 `inject` 怎么声明 → [复盘](docs/postmortem/2026-09-15-client-inject-remote-missing.md)。
- **`ctx.get` 不是取服务的正路**：它按 cordis 文档是「不受 inject 约束的读取」，绕过的是门禁而非服务发现本身，跨挂载位置并不可靠。实测：同一上下文里 `ctx.tools`（inject + 属性访问）一直正常，而 `ctx.get('credentials')` 拿不到服务 —— 旧版有条兜底替它兜着，兜底一删工具就集体「没有 key」。**要服务就用 `inject` + 属性访问**；`agent.ctx.get('tools')` 是「agent scope 的依赖面不由我们决定」的特例，不是通用写法 → [复盘](docs/postmortem/2026-09-15-credential-service-unreachable.md)。
- **告警可能到不了终端**：v1.6.x 的每一处失败都 `warn` 过，维护者终端里一条都没有。判断故障别只看日志，先看文件状态与工具报错。
- **redact 是 schema 驱动的**：`redactSecrets` 只剥 schema 里带 `role('secret')` 的字段。把一个「代码已经不读」的密钥字段从 schema 里删掉，redact 会同时停止保护它 —— 明文改从 describe 线路走出，而功能测试全绿。删密钥字段前先读 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 的「密钥解析契约」。
- **挂载方式**：只用官方 CLI `dsh plugin --profile web add <path>`（它会顺带 reconcile `dsh.profile.bundles`），不要手改 `cordis.patch.yml`。
- **DSH 的 dist-tag 语义各不相同，`latest` 是陷阱**：`next` = 当前承诺支持的线，`alpha` = 前瞻线，`latest` **不可用** —— 多数 `@deepseek-ai/dsh-*` 上它指向很早的版本，具体值一律现查（`npm view @deepseek-ai/dsh dist-tags`）。装宿主必须点名线；锚点语义与红了怎么办见 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的「兼容性」。
- **换包有两个方向相反的假信号，都踩过**：
  - **假红**：`npm install <包>@<tag>` 会把某个恰好没被点名的包**目录清空**（实测 `dsh-client-locale` 与 `dsh-client-ui-primitives` 都中过），随后 typecheck 报「找不到模块」。`--legacy-peer-deps` 也不是解药：它连 npm 的 peer 自动安装一起关掉，`dsh-tools` 自己的 peer 集体缺席。正路是 [scripts/compat-swap.mjs](scripts/compat-swap.mjs) 的「改写 package.json + 裸 `npm install`」。
  - **假绿**：`npm install` 因上游 peer 冲突退出时，`node_modules` 会**原封不动停在旧版本**上，随后 typecheck 与全套测试全绿。所以换包之后必须 `verify` 断言实装版本 —— **「测试全绿」不等于「跑在目标版本上」**。

## 文档网络与自更新

维护成本几乎全在「同步」上；下面五条把它压到最低 —— 从任何一处都能顺着链接找到该改的地方。

- **一条事实只有一个 home**：根 README 讲门面（给访客），本文件讲规则与仪表盘；子目录双件分讲「有什么 / 改哪」（README）与「在这里要怎么干」（AGENTS.md，进入该目录时自动注入）；[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 讲不变的设计与防错，[.agents/notes/](.agents/notes/) 讲为什么，[docs/PUBLISHING.md](docs/PUBLISHING.md) 讲怎么发。别处一律链接，不复制。
- **能自证的不抄（自更新）**：凡是有「会自己更新的来源」的事实就指向它 —— 测试与类型检查 → [Actions](https://github.com/zlZayn/dsh-zhihu-search/actions)，发布版本 → [npm](https://www.npmjs.com/package/dsh-zhihu-search)，产物一致性 → 哈希比对。抄一次数字就要手动跟一次（本文件已经因此过时过两回），所以只留指针与不随数字漂移的定性结论。
- **能落成校验的不写散文**：五条红线 → 测试；发版噪音 → [release-guard](scripts/release-guard.mjs)；上游契约 → [contract.yml](.github/workflows/contract.yml)；**宿主版本线 → [compat.yml](.github/workflows/compat.yml)**；文档链接与换行 → 校验脚本。机器判得了的规则，就别指望人记得。
- **改一处要查得到同步点**：每个子目录 README 的「变更影响路由」是同步清单的入口；新增或改名文件后必须回填，否则下一个人只能靠运气。
- **坑按作用域分流**：跨模块、踩了整条链就崩的留在本文件；模块内的下放到对应子目录 `AGENTS.md`，本文件不重复。

## 文档地图

- 外部贡献入口 → [CONTRIBUTING.md](CONTRIBUTING.md)（双语，另一份是 [CONTRIBUTING_en.md](CONTRIBUTING_en.md)）
- 架构设计 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 发布流程 → [docs/PUBLISHING.md](docs/PUBLISHING.md)
- 事故复盘 → [docs/postmortem/](docs/postmortem/)
- 源码手册 → [src/README.md](src/README.md)
- 工具层 → [src/tools/README.md](src/tools/README.md)
- 参数编译、文本清洗与错误规范化 → [src/utils/README.md](src/utils/README.md)
- 呈现层 → [src/present/README.md](src/present/README.md)
- 浏览器半体 → [src/client/README.md](src/client/README.md)
- 测试对应关系 → [test/README.md](test/README.md)
- 构建与校验脚本 → [scripts/README.md](scripts/README.md)
- 图片资源与重截流程 → [assets/README.md](assets/README.md)（`banner.svg` 头图双语共用，其余资产的引用面见该文件）+ [assets/AGENTS.md](assets/AGENTS.md)（改渲染面必重截，先问再占用浏览器）
