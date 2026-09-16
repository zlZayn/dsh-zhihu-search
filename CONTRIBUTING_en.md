[简体中文](CONTRIBUTING.md) · [English](CONTRIBUTING_en.md)

# Contributing — Getting involved with dsh-zhihu-search

Issues and PRs both go through [GitHub](https://github.com/zlZayn/dsh-zhihu-search).

## What a bug report needs

- Plugin version, DSH version and which line it came from (`next` / `alpha` / `latest`), Node version.
- Install shape (symlink to the repo / registry copy), whether the host was restarted, and whether the browser half and the host half are the same version.
- A minimal reproduction, and the full error text.

How to check the first two → [AGENTS.md](AGENTS.md), the "活跃坑" section.

## Before proposing a feature

Read [.agents/notes/](.agents/notes/) first — proposals already rejected by measurement live there, and every record lists the alternatives it beat.
What the design and the platform will not do → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Before opening a PR

- Run `npm test` once.
- Read "全局规则" in [AGENTS.md](AGENTS.md) and [test/README.md](test/README.md): the merge criteria live there, and the red lines are pinned by [test/redlines.test.ts](test/redlines.test.ts).
- Do not touch the version number (release process → [docs/PUBLISHING.md](docs/PUBLISHING.md)).
