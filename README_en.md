<p align="center">
  <h1 align="center">dsh-zhihu-search</h1>
</p>

<div align="center">
  <p><strong>Empowering DeepSeek Harness with Zhihu Insights</strong></p>
  <p><em>赋予 DeepSeek Harness 检索知乎社区的能力</em></p>

  <p>
    <a href="https://developer.zhihu.com/"><img src="https://img.shields.io/badge/Zhihu%20Open%20Platform-Official%20API-0084FF?style=flat&logo=zhihu&logoColor=white" alt="Zhihu Open Platform Official API"></a>
    <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek%20Harness-Plugin-4176E6?style=flat" alt="DeepSeek Harness Plugin"></a>
    <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/dsh--plugin-Auto%20Discovered-orange?style=flat" alt="dsh-plugin"></a>
  </p>

  <p>
    <a href="https://github.com/zlZayn/dsh-zhihu-search/actions/workflows/ci.yml"><img src="https://github.com/zlZayn/dsh-zhihu-search/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://www.npmjs.com/package/dsh-zhihu-search"><img src="https://img.shields.io/npm/v/dsh-zhihu-search.svg" alt="npm"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
    <a href="https://slsa.dev/"><img src="https://img.shields.io/badge/SLSA-Provenance-green?logo=slsa" alt="SLSA Provenance"></a>
  </p>

  <p>
    <a href="README.md">简体中文</a> · <strong><a href="README_en.md">English</a></strong>
  </p>
</div>

---

> [!NOTE]
> **Built on the official Zhihu Open Platform API**, not web scraping. All search results include citable original links, and Zhihu's own results also carry their upvote counts, ensuring every model response is verifiable.

Equips DSH with three Zhihu tools: in-site search, global web search, and Zhida direct answers — returning a list of citable sources instead of an unverifiable summary.

<p align="center">
  <img src="assets/settings-card_en.png" alt="Zhihu Search card in the plugin settings" width="600">
  <br>
  <em>Sits alongside other plugins in <strong>Settings → Plugins → Plugin configuration</strong>. Enter your Access Secret and it takes effect immediately.</em>
</p>

## Tools

Installing adds three tools to the model:

| Tool | One line | Use it for |
|---|---|---|
| `zhihu_search` | Searches Zhihu's own questions and articles; sortable by votes / comments / time | Chinese experience, product reviews, industry discussion, engineering practice |
| `zhihu_global_search` | Searches Zhihu's global web index; the results mix in some Zhihu content | Finding material on a specific site |
| `zhihu_zhida` | Zhihu Zhida: a synthesized answer that pulls a topic together | Complex Chinese questions that need "retrieve, then summarize" |

The three sections below are each tool's full parameter set and limits. The model only ever sees the semantic parameters in these tables — Zhihu's native string query syntax is compiled inside the plugin, so the model cannot get it wrong.

### `zhihu_search` — in-site search

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `query` | string | **required** | Search keywords; works best in Chinese. |
| `count` | integer | `5` | Number of results, 1–10. |
| `sortField` | enum | `default` | `default` keeps relevance order; `voteUpCount` upvotes · `commentCount` comments · `editTime` last edit. |
| `order` | enum | `desc` | `desc` or `asc`. Only applies when `sortField` is set. |
| `minValue` | number | — | Inclusive lower bound on the sort field, **requires `sortField`**. With `sortField=voteUpCount` and `minValue=100` you get "only 100+ upvotes". |
| `publishedAfter` | string | — | Only content published after this date, `YYYY-MM-DD`. |
| `publishedBefore` | string | — | Only content published before this date, `YYYY-MM-DD`. |

**Limits**: no domain filter — in-site results all come from Zhihu anyway; use `zhihu_global_search` to search a specific site. `count` caps at 10. `minValue` and a non-default `order` require `sortField`: without it the call is rejected with a correction hint rather than silently returning unfiltered results. **No pagination**: `hasMore` is always `false`; for more results change the keywords or the sort.

### `zhihu_global_search` — global web index search

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `query` | string | **required** | Search keywords. |
| `count` | integer | `8` | Number of results, 1–20 — wider than in-site. |
| `site` | string | — | Only this domain, e.g. `github.com`. A full URL is reduced to its host. |
| `publishedAfter` | string | — | Only content published after this date, `YYYY-MM-DD`. |
| `publishedBefore` | string | — | Only content published before this date, `YYYY-MM-DD`. |
| `searchDb` | enum | `all` | `all` · `realtime` newest · `static` long-term index. |

**Limits**: **there is no sorting parameter** — the endpoint ignores the sort field, so the plugin does not offer a knob that does nothing. **There is no pagination parameter either**: at most 20 results per call, and the server truncates anything larger. `site` rejects `zhihu.com` and its subdomains; Zhihu refuses that request outright. The results **mix in some Zhihu content**; to search Zhihu's own questions and articles specifically, use `zhihu_search`.

### `zhihu_zhida` — Zhida

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `question` | string | **required** | The question; the more specific you are, the better. |
| `mode` | enum | `thinking` | `fast` quick answer · `thinking` deep reasoning · `agent` multi-step retrieval. |
| `includeReasoning` | boolean | `false` | Also return the reasoning trace. Off by default to save context; turn it on when checking an answer. |

**Limits**: this is **not a search** — it returns a generated answer, not a list of sources. The answer is generated by Zhihu and may be wrong; verify anything that matters. The reasoning trace is omitted by default.

## Capabilities

- The three tools do not overlap: in-site for experience, global index for material, Zhida for synthesis — the model picks by question type.
- Search returns structured source entries (title / URL / snippet / author / upvotes), every one carrying a URL, so results can be cited and checked.
- Results render both as source cards and as plain Markdown, so they stay readable anywhere.

## Install

### Requirements

- DSH `0.1.5-rc.2`
- Node `>= 20`

### From source

```bash
git clone https://github.com/zlZayn/dsh-zhihu-search.git
cd dsh-zhihu-search
npm install && npm run build

dsh plugin --profile web add "$PWD"
```

`dsh plugin` installs the package into the profile and lists it in `dsh.profile.bundles`. Restart `dsh --profile web` to pick it up.

### From npm

```bash
dsh plugin --profile web add dsh-zhihu-search
```

### Discovery and install

- **npm**: [`dsh-zhihu-search`](https://www.npmjs.com/package/dsh-zhihu-search)
- **GitHub**: [`zlZayn/dsh-zhihu-search`](https://github.com/zlZayn/dsh-zhihu-search)

The repository carries the GitHub topic [`dsh-plugin`](https://github.com/topics/dsh-plugin), which is how plugin marketplaces discover plugins.

## Configuration

### In the settings UI

Open **Settings → Plugins → Plugin configuration → Zhihu Search**, enter the Access Secret and save. It takes effect immediately, with no DSH restart.

Get the Access Secret from the [Zhihu Open Platform profile](https://developer.zhihu.com/profile); the settings card links to the same place.

### Use an environment variable instead

If you would rather not keep the secret in settings, use the `ZHIHU_ACCESS_SECRET` environment variable. Or put a different name in the card's "Credential reference" to point at another environment variable or credential record.

## Security and boundaries

- The Access Secret only travels between the settings UI, the credential scope and the environment: never logged, never in a cache key in clear text, never committed.
- Returned content is treated as untrusted external data: snippets are stripped of HTML tags, URLs of tracking parameters.
- Only `developer.zhihu.com` is contacted; nothing is proxied or forwarded.

## License

[MIT](LICENSE).

## Contributing

Maintainer doc map in [AGENTS.md](AGENTS.md); the design constraints that do not change in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the release process in [docs/PUBLISHING.md](docs/PUBLISHING.md).
