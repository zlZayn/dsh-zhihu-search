# dsh-zhihu-search — 维护索引

## 状态

- Released v1.0.0 → <https://github.com/zlZayn/dsh-zhihu-search>
- 三个工具、设置卡片、149 条测试与本地真机验证全部完成；npm 未发布（见 [docs/PUBLISHING.md](docs/PUBLISHING.md)）。

## 全局规则

- 结论必须来自实测，不得来自文档推断 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 红线以测试固化（依赖分层、呈现隔离、无全局状态、模型不见原始语法）→ [test/README.md](test/README.md)
- 对外可见行为变化，同一次改动内同步 [README.md](README.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 决策理由 → [.agents/notes/](.agents/notes/)

## 常用命令

- `npm run build`（host tsc + client tsc + esbuild）· `npm run typecheck` · `npm test`（先 build 再 vitest）

## 验证快照（2026-09-12 实跑）

- test: 149 passed / 0 failed（12 个文件）
- typecheck: clean（src + test）· build: clean
- 装入运行中的 web profile；设置面板出现卡片；经 DSH 工具管线实调 `zhihu_search` / `zhihu_global_search` 返回真实结果

## 待办

- [ ] 直答流式读取无本地超时 → [src/README.md](src/README.md)
- [ ] 卡片文案进 DSH locale 字典（现为硬编码中文）

## 活跃坑（工具链与 DSH 平台）

知乎 API 自身的反直觉处归 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，此处只记会咬人的工程陷阱。

- `link:` 安装下 DSH 直接读 `lib/`：改完 `src/`（含浏览器半体）必须重新 build，否则跑的还是旧代码
- `dsh.profile.bundles` 只在启动时读取；免重启生效必须走 `cordis.patch.yml` 的 patch 层
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
