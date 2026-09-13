# dsh-zhihu-search — 维护索引

## 状态

- 已发布版本以 [package.json](package.json) 的 `version` 为准 → <https://github.com/zlZayn/dsh-zhihu-search>
- npm → <https://www.npmjs.com/package/dsh-zhihu-search>（由 [release.yml](.github/workflows/release.yml) 带 provenance 签名发布）
- 功能、设置卡片与本地真机验证全部完成；工具清单见 [README.md](README.md)。
- 市场收录：仓库已带 `dsh-plugin` topic；`awesome-dsh-plugin` 的 PR 被「仓库满 1 天」闸门挡住 → [.agents/notes/2026-09-12-marketplace-submission.md](.agents/notes/2026-09-12-marketplace-submission.md)

## 全局规则

- 结论必须来自实测，不得来自文档推断 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 红线以测试固化（依赖分层、呈现隔离、无全局状态、模型不见原始语法）→ [test/README.md](test/README.md)
- 对外可见行为变化，同一次改动内同步 [README.md](README.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 改根 [README.md](README.md) 必同改 [README_en.md](README_en.md)，冲突以中文为准
- 决策理由 → [.agents/notes/](.agents/notes/)

## 事实来源（只查不抄）

- 版本号、依赖、宿主兼容性 → [package.json](package.json)
- 工具参数、默认值与上限 → [src/tools/](src/tools/) 各模块的常量，由 [test/tool.test.ts](test/tool.test.ts) 守护
- 端点语法与实测偏差 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 构建产物的运行方式 → [docs/PUBLISHING.md](docs/PUBLISHING.md)
- DSH 平台知识（插件装配、Remote API、设置卡片、i18n、工具契约）→ [DSH cookbook](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/cookbook)，每篇都有 `.zh.md` 中文版

## 常用命令

- `npm run build`（host tsc + client tsc + esbuild）· `npm run typecheck` · `npm test`（先 build 再 vitest）

## 验证快照（2026-09-12 实跑）

- CI: ci.yml 与 release.yml 均绿（首个发布 run 30s）
- test: 162 passed / 0 failed（13 个文件）
- typecheck: clean（src + test）· build: clean
- 装入运行中的 web profile；设置面板出现卡片；经 DSH 工具管线实调 `zhihu_search` / `zhihu_global_search` 返回真实结果

## 待办

- [ ] 提 `awesome-dsh-plugin` PR：条目已提交在 fork 分支 `add-dsh-zhihu-search`，等仓库满 1 天（本地 2026-09-14 01:19）后跑一条 `gh pr create` → [.agents/notes/2026-09-12-marketplace-submission.md](.agents/notes/2026-09-12-marketplace-submission.md)
- [ ] 全网搜索的翻页：`hasMore` 已让模型知道结果被截断，但没有翻页参数去取 → 属 minor（新参数）
- [ ] 直答流式读取无本地超时 → [src/README.md](src/README.md)

## 活跃坑（工具链与 DSH 平台）

知乎 API 自身的反直觉处归 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，此处只记会咬人的工程陷阱。

- `link:` 安装下 DSH 直接读 `lib/`：改完 `src/`（含浏览器半体）必须重新 build，否则跑的还是旧代码
- `dsh.profile.bundles` 只在启动时读取 → **首次挂载**新插件要重启，或走 `cordis.patch.yml` 的 patch 层
- **升级已挂载的插件免重启**：`dsh-client-hmr`（`dsh-web-app` 的运行时依赖）以 500ms 轮询插件 bundle，被 `dsh plugin add` 改写即原地换装 → 发版后可直接 `dsh plugin --profile web add <pkg>@<ver>`，不必请人重启
- 挂载用官方 CLI `dsh plugin --profile web add <path>`，它会顺带 reconcile `dsh.profile.bundles`；不要手改 `cordis.patch.yml`
- 可用作值导入的外部模块只有 `PLATFORM_MODULES`（DSH `packages/client/web/src/platform.ts`）；超出该清单必须写 `dsh.client.inject` / `external`
- `lib/client.js` 专供浏览器半体；host 模块不得命名 `src/client.ts`，否则被 esbuild 覆盖（[复盘](docs/postmortem/2026-09-12-client-js-path-collision.md)）
- 测试默认从 `src/` 导入，**不跑编译图**；产物级回归靠 `test/dist.test.ts`
- `@deepseek-ai/dsh-client-ui-primitives` 是浏览器静态库，Node 里加载不了（缺 `clsx`）；测试中须替身
- 设计令牌只有 `--dsw-alias-*`，不存在 `--dsw-color-*` 系列
- 本地用 `--legacy-peer-deps` 安装会让 `package-lock.json` 缺自动 peer，`npm ci` 随即失败；依赖变更后用 `npm install --registry=https://registry.npmjs.org/` 重建
- 锁文件的 `resolved` 会被钉在生成时的 registry 上；国内镜像生成的锁文件不应提交

## 文档地图

- 架构设计 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 发布流程 → [docs/PUBLISHING.md](docs/PUBLISHING.md)
- 源码手册 → [src/README.md](src/README.md)
- 工具层 → [src/tools/README.md](src/tools/README.md)
- 编译器与文本清洗 → [src/utils/README.md](src/utils/README.md)
- 呈现层 → [src/present/README.md](src/present/README.md)
- 浏览器半体 → [src/client/README.md](src/client/README.md)
- 测试对应关系 → [test/README.md](test/README.md)
- 构建脚本 → [scripts/README.md](scripts/README.md)
