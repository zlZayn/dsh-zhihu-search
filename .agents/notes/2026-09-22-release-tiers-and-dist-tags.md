# 发版档位与 dist-tag：为什么必须有 `prerelease`，以及 dist-tag 凭什么判

> **本文的 workflow 形态已被取代**（2026-09-22，同一天稍后）：用户拍板本仓改成**版本驱动** ——
> `release.yml` **不再 bump**，发布的就是 `package.json` 里那个号；`tier` / `preid` 输入撤销，
> dist-tag 由**版本自己那段**推（与 `dsh-ds-balance` 同形）。取代它的是
> [发布改成版本驱动：bump 是发布前的独立一步](2026-09-22-version-driven-release.md)。
> **本文仍然有效的部分**：semver 的实测表（`premajor` vs `prerelease`）、
> 「dist-tag 按结果版本判、不按输入参数判」这条判据、以及「workflow 自己 bump 会让工作树停在旧号」
> 这个根因 —— 新记录只改形态，不改这些结论。**正文一字未改**（沿用本仓惯例）。

**一轮之内给 `release.yml` 加了一个档、改了 dist-tag 的判据、修了一句自相矛盾的提示，这是它的决策记录。**
数字一律是本机实测（npm 12.0.1 / Node v24.18.0），不是从文档推断。

## 问题

工作区已定：这次发布落在 **`2.0.0` 这条 major 线的 alpha 通道**，目标版本 **`2.0.0-alpha.1`**
（npm 上的 `alpha` 当前是 `2.0.0-alpha.0`，**不可覆盖**）。

而本仓当时的 workflow **产不出它**。逐个档实测：

| 从这个 `version` | `npm version premajor --preid=alpha` | `npm version prerelease --preid=alpha` |
|---|---|---|
| `1.6.3` | `2.0.0-alpha.0` | `1.6.4-alpha.0` |
| `2.0.0-alpha.0` | **`3.0.0-alpha.0`** | **`2.0.0-alpha.1`** |
| `2.0.0-alpha.1` | **`3.0.0-alpha.0`** | `2.0.0-alpha.2` |
| `2.0.0`（稳定） | `3.0.0-alpha.0` | `2.0.0-0` |

**根因**：SemVer 的 `premajor` 是「**开一条新的 X.Y.Z 预发布线**」，不是「把预发布计数 +1」。
`2.0.0-alpha.0` 解析成 `major=2, minor=0, patch=0, prerelease=[alpha, 0]`；
`premajor` 见 prerelease **不是 `[0]`**（即不是 pre-major 的零位），就先把 major 加一 → `3.0.0-alpha.0`。
`1.6.3` 没有 prerelease，才走「major 加一 + 起 alpha」那条路 —— 这就是当初 `2.0.0-alpha.0` 的来法。
`prerelease` 才是「同一个 X.Y.Z 上把计数 +1」。

**第二层问题（更隐蔽）**：workflow 在 `:109-118` **自己 bump**，
而 `:105` 的漂移提示却写着 `bump with: npm version <patch|minor|major> --no-git-tag-version` ——
**叫人在本地 bump**。两边矛盾：照它做，本地 bump 出来的版本会被 workflow **再 bump 一次**。
我第一版提的「先人工 bump 到 alpha.1 再跑 premajor」正是被这句话引到错路上的（Lead 实测推翻，见下）。

**第三层问题（会发错 tag）**：原先 dist-tag **按 `tier` 判** —— 只有 `tier=premajor` 带 `--tag <preid>`，
其余一律默认 `latest`。于是「用 `patch` 去推进 alpha 线」会把一个预发布构建**推上 `latest`**，
而 `latest` 停在 1.6.3 —— workflow 顶部那段注释警告的正是这件事，却是它自己做出来的。

## 决策（三处最小修）

1. **`tier` 加 `prerelease` 档**，bump 分支加 `npm version prerelease --preid=…`。
   两个预发布档的分工写进 workflow 头部与 [docs/PUBLISHING.md](../../docs/PUBLISHING.md)：
   `prerelease` = 同一 `X.Y.Z` 线上的下一个 alpha；`premajor` = 开新线。
2. **dist-tag 按「结果版本」判，不按 `tier` 判**：bump 步算出 `version` 之后
   用 `case "$version" in *-*)` 推出 `dist_tag`（带 `-` → `preid` 同名 tag，否则空 = 默认 `latest`），
   写进 step output；**publish 步与 GitHub Release 的 `--prerelease` 读同一个输出**。
   判据只此一处 —— 两处各判一次就是新的漂点。
3. **修 `:105` 的提示语**：写明本 workflow 自己 bump、tier 输入才是选版本线的地方；
   真撞上漂移时先本地把两处对齐再重跑。

**我们最终要跑的命令**（等 Lead 说「发」）：

```bash
gh workflow run release.yml -f tier=prerelease -f preid=alpha
```

从 `2.0.0-alpha.0` 得到 **`2.0.0-alpha.1`**，且 `--tag alpha`（`latest` 不动）。

## 实测证据

**（a）三个档的版本结果**（临时目录里以当前 `package.json` / `package-lock.json` 的副本、每次重置回 `2.0.0-alpha.0` 跑）：

```
tier=prerelease  ->  version=v2.0.0-alpha.1  dist-tag=alpha
tier=premajor    ->  version=v3.0.0-alpha.0  dist-tag=alpha   ← 仍发 alpha，不会推 latest；但版本号不是我们要的
tier=patch       ->  version=v2.0.0          dist-tag=<默认 latest>
```

**（b）"这个版本已在 npm 上吗" 的子进程判据**（`:122-130` 的 `npm view` 分支，幂等那一步靠它）：

```
dsh-zhihu-search@2.0.0-alpha.0  已发布=true  => published=true
dsh-zhihu-search@2.0.0-alpha.1  已发布=false => published=false
dsh-zhihu-search@2.0.0          已发布=false => published=false
```

**（c）workflow 结构自检**（用仓内 `node_modules` 的 `yaml` 解析改后的文件）：

```
YAML parse: OK
tier options: ["patch","minor","major","prerelease","premajor"]
bump: prerelease 分支在 / premajor 分支在 / 写了 dist_tag / 判据是 *-*)
publish: 读 steps.bump.outputs.dist_tag，且不再出现 inputs.tier
release: --prerelease 读同一个输出，且不再出现 inputs.tier
guard: 旧的 "bump with: npm version" 提示已消失，改为写明 workflow 自己 bump
```

**（d）本仓没有 bash，所以没在本地整段跑 workflow 的 shell**（`bash` / `wsl` 都不在 PATH 上，
Git Bash 未安装）。上面 (a)(b) 是把 workflow 里**同一串命令**逐条跑出来的等价物，
(c) 是结构自检。**真正跑一次 `release.yml` 只能在 `main` 上 dispatch** —— 本仓规矩写明
「PR 上的 CI 只跑 ci.yml，动 `release.yml` 的 PR 就算绿勾也不代表发布链路验过」，
所以发布那次 dispatch 本身就是这条链的首次实跑（见 [docs/PUBLISHING.md](../../docs/PUBLISHING.md) 的「CI」）。

## 与 balance 的关系（**本轮不动它**）

`dsh-ds-balance` 的 `release.yml` 是**版本驱动**的：它不 bump，直接按结果版本选 dist-tag。
两仓同一个活两套语义这件事已记进工作区 [AGENTS.md](../../../AGENTS.md) 的待办 #4，
**本轮只最小修 zhihu，没有统一两仓语义**。判据仍是工作区那条：跨仓取舍不在子仓里决定。

## 影响与回滚

- **对已发布产物零影响**：改的是 workflow，不进 npm 包、不进 `lib/`。
  `release-guard.mjs` 判它算不算「产物改动」与本决策无关 —— 这次发布的产物改动来自
  [展示元数据那一条](2026-09-22-plugin-display-metadata.md)。
- **回滚**：一次 `git revert`。没有数据、没有 profile、没有版本号改动。
- **一处仍需人判**：`prerelease` 档在**没有预发布段**的版本上会产出 `2.0.0-0` 这种怪东西
  （见上表最后一行）。本次用不到（`version` 本来就是 `2.0.0-alpha.0`），
  但真要在一个稳定版上开 alpha 线，得用 `premajor`。这条判据写在 workflow 头部注释里。
