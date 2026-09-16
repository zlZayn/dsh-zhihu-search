<p align="center"><strong><a href="CONTRIBUTING.md">简体中文</a></strong> · <a href="CONTRIBUTING_en.md">English</a></p>

# Contributing — 参与 dsh-zhihu-search

欢迎 —— issue 与 PR 都走 [GitHub](https://github.com/zlZayn/dsh-zhihu-search)。提 PR 前跑一次 `npm test`；报 bug 前先看 [AGENTS.md](AGENTS.md) 的「活跃坑」。

## 报 bug 带上这些

- 插件版本、DSH 版本（**以及它装自哪条线**：`next` / `alpha` / `latest`，三者语义不同）、Node 版本。
- 安装形态（profile 里那份是**符号链接到仓库**还是 **registry 副本**）、host 是否重启过、浏览器半体与 host 半体是否同版本 —— 后者不热更，一次构建或一次安装就能造成两半体错配。
- 最小可重复的复现步骤，以及**完整报错原文**（不要转述）。

## 提功能前先翻决策记录

每条决策都记着它击败的替代方案（[.agents/notes/](.agents/notes/)）；不变的设计与平台限制见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。最常被重提、已由实测否掉的几条：

- **给 `global_search` 加翻页或 `targetCount`** —— 端点没有第二页，`Count` 上限是服务端硬截断。
- **把额度做进设置卡片** —— 代价是一条会随 DSH 升级失效的新构建链，收益只是一个只读数字。
- **把 `accessSecret` 移出 schema** —— 它是 redact 锚点，移出去明文会从 describe 线路漏给浏览器。
- **给参数加 `minimum` / `dependentRequired`** —— DSH 的值 schema DSL 拒绝它们，参数耦合只能写在描述里。

## 不会被合并的几条

- **破五条红线**（依赖分层 / 呈现隔离 / 模型上下文隔离 / 无全局状态 / 模型不见原始语法）—— 守卫是 [test/redlines.test.ts](test/redlines.test.ts)，删改用例等于改契约。
- **把 `@deepseek-ai/*` 放进 `dependencies`** —— 宿主与插件各持一个 Context 实例，服务单例就破了。
- **改了对外可见行为却不同步文档** —— [README.md](README.md) / [README_en.md](README_en.md) / [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 要在同一次改动里跟上，两份 README 冲突以中文为准。
- **动版本号或自己发版** —— 发版是维护者的单入口 [release.yml](.github/workflows/release.yml)，规则见 [docs/PUBLISHING.md](docs/PUBLISHING.md)。
- **结论从文档推断而来** —— 改动以实测为准，没跑过会被要求先跑一遍。
