# dsh-zhihu-search — 维护索引

## 状态

- 已发布版本以 [package.json](package.json) 的 `version` 为准 → <https://github.com/zlZayn/dsh-zhihu-search>
- npm → <https://www.npmjs.com/package/dsh-zhihu-search>（由 [release.yml](.github/workflows/release.yml) 手动触发，一次跑完 bump → 发布 → tag → GitHub Release）
- 功能、设置卡片与本地真机验证全部完成；工具清单见 [README.md](README.md)。
- 市场收录：仓库已带 `dsh-plugin` topic；`awesome-dsh-plugin` 的 [PR #5037](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5037) 已提，等评审 → [笔记](.agents/notes/2026-09-12-marketplace-submission.md)

## 全局规则

- 结论必须来自实测，不得来自文档推断 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 红线以测试固化，共五条（依赖分层、呈现隔离、模型上下文隔离、无全局状态、模型不见原始语法）→ [test/README.md](test/README.md)
- 对外可见行为变化，同一次改动内同步 [README.md](README.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 改根 [README.md](README.md) 必同改 [README_en.md](README_en.md)，冲突以中文为准
- 决策理由 → [.agents/notes/](.agents/notes/)
- 发版授权：patch / minor 按 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的问题链定档后**直接发**；**major 必须先问人类**

## 事实来源（只查不抄）

- 版本号、依赖、宿主兼容性 → [package.json](package.json)
- 工具参数、默认值与上限 → [src/tools/](src/tools/) 的常量与 [src/transport.ts](src/transport.ts) 的端点契约常量（上限只住后者，工具层取别名），由 [test/tool.test.ts](test/tool.test.ts) 守护
- 端点语法与实测偏差 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 构建产物的运行方式 → [docs/PUBLISHING.md](docs/PUBLISHING.md)
- DSH 平台知识（插件装配、Remote API、设置卡片、i18n、工具契约）→ [DSH cookbook](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/cookbook)，每篇都有 `.zh.md` 中文版
- **有自更新来源的事实一律指向来源**：测试与类型检查 → Actions；发布版本 → npm badge。别在本文件留快照数值。

## 常用命令

- `npm run build`（host tsc + client tsc + esbuild）· `npm run typecheck` · `npm test`（先 build 再 vitest）· `npm run test:contract`（打真实接口，需 `ZHIHU_ACCESS_SECRET`，日常 CI 不跑）
- 真机验收：`ZHIHU_ACCESS_SECRET=xxx node scripts/acceptance.mjs [包目录]` —— 默认验 profile 里装的那份，覆盖真实接口 + 宿主 schema 校验 + 渲染文本，见 [scripts/README.md](scripts/README.md)
- 发版：`gh workflow run release.yml -f tier=patch|minor|major` —— 唯一入口，档位按 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的问题链定

## 验证快照（2026-09-14 实跑）

**会随每次改动漂移的数字一律不抄，指向自更新来源** —— 抄一次就要手动跟一次，本文件已经因此过时过两回。

- 测试与类型检查 → [Actions](https://github.com/zlZayn/dsh-zhihu-search/actions)，每次推送自更新
- 发布版本 → [npm](https://www.npmjs.com/package/dsh-zhihu-search)，badge 自更新

只留下不随数字漂移的定性结论：

- 本机 `npm run build` / `npm run typecheck` / `npm test` 全绿
- 装入运行中的 web profile；设置面板出现卡片；经 DSH 工具管线实调 `zhihu_search` / `zhihu_global_search` 返回真实结果
- 发版链路：v1.2.8 首次由单一入口实跑 —— OIDC 发布、tag、GitHub Release 在一次运行内同步落地
- 「隐藏原生网页工具」：v1.3.1 在真机 profile 上行为验证通过 —— 开关打开后模型的工具面失去 `web_search` / `web_fetch`，关闭即恢复
- 契约测试：本机与 GitHub Actions 都实跑通过（后者由 repo secret `ZHIHU_ACCESS_SECRET` 供燃料，约 38s）；每周一由 [contract.yml](.github/workflows/contract.yml) 跑；日常 `npm test` 不含 live 探针，只多一份底座的离线自检
- 真机验收：v1.4.1 升级 + host 重启后在 profile 安装副本上跑通 —— [scripts/acceptance.mjs](scripts/acceptance.mjs) 9/9 全绿（扩池 / 输出对称 / www 归一化 + 宿主 schema 校验 + 渲染文本），工具面 `zhihu_search` / `zhihu_global_search` 同参数复验一致
- 事故：v1.4.0 的 P0（输出 schema 漂移）由真机验收第 1 条抓到，v1.4.1 修复 → [复盘](docs/postmortem/2026-09-14-output-schema-drift.md)

## 待办

- （无）

## 活跃坑（工具链与 DSH 平台）

知乎 API 自身的反直觉处归 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，此处只记会咬人的工程陷阱。

- 本机 web profile 装的是**版本化 registry 副本**（`~/.dsh/profiles/web/node_modules/dsh-zhihu-search`），不是 `link:` → 改完 `src/` 的生效链是 build → 发版 → `dsh plugin --profile web add dsh-zhihu-search@<ver>` → **host 半体要重启**，客户端半体由 `dsh-client-hmr` 就地换装
- `dsh.profile.bundles` 只在启动时读取 → **首次挂载**新插件要重启，或走 `cordis.patch.yml` 的 patch 层
- `dsh-client-hmr`（`dsh-web-app` 的运行时依赖）只换**浏览器半体**：轮询客户端 bundle，被 `dsh plugin add` 改写即原地换装 → **host 半体换不了**：render、投影、工具描述改了都必须重启（2026-09-13 实测：装上新版不重启，模型看到的仍是旧版渲染）
- 挂载用官方 CLI `dsh plugin --profile web add <path>`，它会顺带 reconcile `dsh.profile.bundles`；不要手改 `cordis.patch.yml`
- 可用作值导入的外部模块只有 `PLATFORM_MODULES`（DSH `packages/client/web/src/platform.ts`）；超出该清单必须写 `dsh.client.inject` / `external`
- `lib/client.js` 专供浏览器半体；host 模块不得命名 `src/client.ts`，否则被 esbuild 覆盖（[复盘](docs/postmortem/2026-09-12-client-js-path-collision.md)）
- 测试默认从 `src/` 导入，**不跑编译图**；产物级回归靠 `test/dist.test.ts`
- 改工具输出字段必须**同时**改三处：Canonical 类型、投影层、`output.schema`。宿主按最后一份校验（`additionalProperties: false`），漏一处 = 整个工具调用失败（v1.4.0 的 P0，见[复盘](docs/postmortem/2026-09-14-output-schema-drift.md)）；`test/tool.test.ts` 的 schema 校验用例是守卫
- **契约测试红了 ≠ 测试过时**：先重跑探针，再改 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 的偏差表，最后才动实现与断言（顺序见 [test/README.md](test/README.md)）。它每周一由 `contract.yml` 跑，密钥是 repo secret `ZHIHU_ACCESS_SECRET`（缺席直接红，不静默跳过）；本地跑之前先确认配额够——一轮约 16 次请求
- **`agent/created` 监听器里同步抛错会否决 agent 创建并回滚**（只有 Promise 拒绝降级为 warn，DSH `core/agent` 实测）→ 该钩子里任何可能抛错的动作都要 try/catch
- 原生网页工具（`web_search` / `web_fetch`）**不在全局层**：web profile 关掉了 base 的全局 `tool-web` 行，改由 **agent preset 的 standing scope** 注册 → 用根上下文的全局视图（`ctx.tools.get(name)`）去判断它们是否存在，**永远得到"不存在"**（v1.3.0 就这样静默失效，见[复盘](docs/postmortem/2026-09-14-hidden-tool-restriction-noop.md)）
- agent scope 上取工具注册表必须走**免 inject 的 `agent.ctx.get('tools')`**；属性访问 `agent.ctx.tools` 抛 `cannot get property "tools" without inject`（agent scope 的依赖面不由调用方决定）
- `@deepseek-ai/dsh-client-ui-primitives` 是浏览器静态库，Node 里加载不了（缺 `clsx`）；测试中须替身
- 设计令牌只有 `--dsw-alias-*`，不存在 `--dsw-color-*` 系列
- 本地用 `--legacy-peer-deps` 安装会让 `package-lock.json` 缺自动 peer，`npm ci` 随即失败；依赖变更后用 `npm install --registry=https://registry.npmjs.org/` 重建
- 锁文件的 `resolved` 会被钉在生成时的 registry 上；国内镜像生成的锁文件不应提交
- 两份 workflow 的 action 均已升 v7。v7 移除了 dummy `NODE_AUTH_TOKEN` 兜底（`.npmrc` 引用 `${NODE_AUTH_TOKEN}`，而 `npm ci` 跑在带真 token 的 `npm publish` 之前）→ 2026-09-13 用 `workflow_dispatch` 在 PR 分支实跑验证过：`npm ci` 通过、publish 认证通过（仅因版本已存在被拒），无需为它留在 v4
- action 版本漂移交给 [.github/dependabot.yml](.github/dependabot.yml)（每周一个 bump PR）；**PR 上的 CI 只跑 ci.yml，动 `release.yml` 的 PR 就算绿勾也不代表发布链路验过**；npm 生态没开，DSH 的 rc 依赖会变噪音
- Trusted Publisher 的 owner 栏填 **GitHub 属主**（`zlZayn`），不是 npm 用户名；2026-09-03 之后新建的连接默认只给 `npm stage publish`，必须显式勾上 `npm publish` —— 填错不会在保存时报错，只在发布时暴露
- npm 连接上的 **Environment name**（本项目 `github-release`）会进 OIDC 校验：job 必须声明同名 `environment:`。不符时实测报 **`404 ... you do not have permission to access it`，而不是 `ENEEDAUTH`** —— 照权限方向查会白费功夫，先比对 environment

## 文档地图

- 架构设计 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 发布流程 → [docs/PUBLISHING.md](docs/PUBLISHING.md)
- 事故复盘 → [docs/postmortem/](docs/postmortem/)
- 源码手册 → [src/README.md](src/README.md)
- 工具层 → [src/tools/README.md](src/tools/README.md)
- 编译器与文本清洗 → [src/utils/README.md](src/utils/README.md)
- 呈现层 → [src/present/README.md](src/present/README.md)
- 浏览器半体 → [src/client/README.md](src/client/README.md)
- 测试对应关系 → [test/README.md](test/README.md)
- 构建脚本 → [scripts/README.md](scripts/README.md)
- 图片资源 → [assets/](assets/)（`cover.svg` 头图双语共用，`cover.jpg` 为旧版位图未引用；设置卡片中英各一张，换图要同改两份）
