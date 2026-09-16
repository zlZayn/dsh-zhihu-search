<p align="center"><strong><a href="CONTRIBUTING.md">简体中文</a></strong> · <a href="CONTRIBUTING_en.md">English</a></p>

# Contributing — Getting involved with dsh-zhihu-search

Welcome — issues and PRs both go through [GitHub](https://github.com/zlZayn/dsh-zhihu-search). Run `npm test` once before opening a PR; before filing a bug, read [AGENTS.md](AGENTS.md) section "活跃坑".

## What a bug report needs

- Plugin version, DSH version (**and which line it came from**: `next` / `alpha` / `latest` — they do not mean the same thing), Node version.
- Install shape (is the copy in your profile a **symlink to the repo** or a **registry copy**), whether the host was restarted, and whether the two halves are the same version — the host half does not hot-reload, so one build or one install desynchronises them.
- A minimal reproduction, and the **full error text** (not a paraphrase).

## Read the decision records before proposing a feature

Every record lists the alternatives it beat ([.agents/notes/](.agents/notes/)); the design that does not change, plus platform limits, live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). These are the most commonly re-proposed, and measurement has already settled them:

- **Pagination or `targetCount` for `global_search`** — there is no second page; the `Count` ceiling is server-side truncation.
- **Quota in the settings card** — it costs a new build chain that breaks on DSH upgrades, to show one read-only number.
- **Moving `accessSecret` out of the schema** — it is the redact anchor; move it out and plaintext leaks to the browser over the describe channel.
- **`minimum` / `dependentRequired` on parameters** — DSH's value schema DSL rejects them, so parameter coupling can only live in the description.

## What will not be merged

- **Breaking one of the five red lines** (dependency layering / presentation isolation / model-context isolation / no global state / no raw syntax to the model) — their executable guard is [test/redlines.test.ts](test/redlines.test.ts); changing a case is changing the contract.
- **Putting `@deepseek-ai/*` into `dependencies`** — host and plugin would then hold two Context instances and the service singleton breaks.
- **Changing externally visible behaviour without syncing the docs** — [README.md](README.md) / [README_en.md](README_en.md) / [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) move in the same change; where the two READMEs disagree, Chinese wins.
- **Bumping the version or releasing yourself** — releases run through the maintainer's single-entry [release.yml](.github/workflows/release.yml); rules live in [docs/PUBLISHING.md](docs/PUBLISHING.md).
- **Conclusions inferred from documentation** — changes are held to measurement; we will ask you to run it first.
