[简体中文](CONTRIBUTING.md) · [English](CONTRIBUTING_en.md)

# Contributing — 参与 dsh-zhihu-search

issue 与 PR 都走 [GitHub](https://github.com/zlZayn/dsh-zhihu-search)。

## 报 bug 带上这些

- 插件版本、DSH 版本以及它装自哪条线（`next` / `alpha` / `latest`）、Node 版本。
- 安装形态（符号链接到仓库 / registry 副本）、host 是否重启过、浏览器半体与 host 半体是否同版本。
- 最小可重复的复现步骤，以及完整报错原文。

前两条怎么查 → [AGENTS.md](AGENTS.md) 的「活跃坑」。

## 提功能前

先翻 [.agents/notes/](.agents/notes/) —— 已被实测否掉的提案都在那里，每条都记着它击败的替代方案。
设计上与平台上的「做不到」→ [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 提 PR 前

- 跑一次 `npm test`。
- 读 [AGENTS.md](AGENTS.md) 的「全局规则」与 [test/README.md](test/README.md)：合并判据在那里，红线由 [test/redlines.test.ts](test/redlines.test.ts) 固化。
- 不要动版本号（发版流程 → [docs/PUBLISHING.md](docs/PUBLISHING.md)）。
