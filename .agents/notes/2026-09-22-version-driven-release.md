# 发布改成版本驱动：bump 是发布前的独立一步，排在截图之前

**一轮之内把 `release.yml` 从「档位驱动」改成「版本驱动」，并把顺序写成规则，这是它的决策记录。**
（它取代[发版档位与 dist-tag](2026-09-22-release-tiers-and-dist-tags.md) 里的 workflow 形态，那份的 semver 实测表仍然有效。）

## 问题：图里的版本号永远是旧的

重拍卡片图时发现：界面上的版本 tag 是 **`v2.0.0-alpha.0`** —— 而那是 **npm 上已经发布的那一版**。
当轮工作树里的号也是它，因为**发布流程自己 bump**：

```
工作树 version = 上一个已发布版本  →  截图拍到的就是旧号  →  发布时才 bump 成新号
```

这不是显示错误，是**流程顺序没定死**。要发的号在发布那一刻才诞生，所以「发布前的截图」**必然**拍旧号。

## 先查清一件事：那个版本 tag 从哪来

| 环节 | 结论 | 出处 |
|---|---|---|
| 界面上的 tag | `<Tag>{t('versionTag', { version: pkg.version })}</Tag>` | `packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx:569` |
| `pkg.version` 来源 | 远端 `BundleInfo.version` → `packageView()` 原样带着 | 同仓 `manager-store.ts:332-357` 与 `presentation.ts` |
| Host 侧的 `BundleInfo.version` | `bundleManifest(...)` 读出来的 **`package.json.version`** | `packages/boot/plugin-manager/src/index.ts:255-263` |
| `bundleManifest` | `resolveBundleDir` → **`readProfileManifest`** | `packages/boot/plugin-manager/src/operations.ts:58-62` |
| `readProfileManifest` | `join(dir, 'package.json')` + `readFileSync` + `JSON.parse` | `packages/boot/app-boot/src/profile.ts:530-543` |

**`host 实时读清单`，不是烘在产物里。** 反证：本仓 `lib/index.js` 与 `lib/client.js` 里
`grep 2.0.0-alpha.0` **各 0 处**，而界面显示了这个号 —— 号只能来自运行时读到的 `package.json`。
（同一族事实：`readPluginMeta` 也是**按请求**读展示元数据的，见 [插件展示元数据](2026-09-22-plugin-display-metadata.md)。）

**推论：重拍前不需要重新 `npm run build`** —— 只要 bump 过 `package.json` 并刷新页面，
tag 就会变成新号。构建与否只影响 JS/CSS，不影响这个号。

## 决策

### 1 · `release.yml` 不再 bump（版本驱动，与 `dsh-ds-balance` 同形）

- 删掉 `Bump both version fields` 步与 `tier` / `preid` 两个输入；新加一步 `Read the version to publish`：
  读 `package.json.version`，并由**版本自己那段**推 dist-tag（`2.0.0-alpha.1` → `alpha`，稳定版 → 空 = 默认 `latest`）。
- **保留**三样（不是一起删）：`package.json` ↔ `package-lock.json` 的一致 guard、
  「该版本已在 npm 上就跳过 publish」的幂等判据、以及**判据走结果版本而不是走输入参数**这一点。
- 提交步改成**有残留才提交**（版本驱动下没有 bump 改动是常态，`git commit` 空跑会红）。
- 「忘了 bump」的症状因此变成**幂等那一步报 `<版本> 已在 npm 上`** —— 报错信息也按这个改写了。

### 2 · 版本号落地 `2.0.0-alpha.1`

`npm version 2.0.0-alpha.1 --no-git-tag-version` → `package.json` 与 `package-lock.json`（含 `packages[""]`）
三处一起写。`2.0.0-alpha.0` 已发在 npm 上、**不可覆盖**，所以下一号就是它。
本仓没有别处写死版本号（`src/`、`scripts/`、`locale/`、`icon.svg` 全 0 处实测）。

### 3 · 顺序写成规则：**bump → 提交 → 再截图 → 最后发布**

落点四处：
- [docs/PUBLISHING.md](../../docs/PUBLISHING.md) 的「发版前确认」加第 0 条（顺序）与「发版」两步命令；
- 根 [AGENTS.md](../../AGENTS.md) 的「常用命令」；
- [assets/AGENTS.md](../../assets/AGENTS.md) 的验收：**版本 tag 等于当前 `package.json` 的 `version`** 是判废项；
- 工作区 [AGENTS.md](../../../AGENTS.md) 的跨仓规则 5b（两仓同一条）。

### 4 · 落成断言，不写成散文

跨仓规则 5b 要求「`release.yml` 里不得出现改写版本的调用」，所以：

- [scripts/check-release.mjs](../../scripts/check-release.mjs) 新增并导出 `findVersionWrites(source)`：
  只看**会执行的命令行** —— YAML 注释与 `echo` 不算（否则「提醒你先本地 bump」这句正确的话会被自己判红）。
- [test/release-workflow.test.ts](../../test/release-workflow.test.ts)：正向断言（真文件 0 命中、
  版本号读自清单、两个下游读同一个 dist-tag 输出、幂等判据仍在）+ **反向控制**（上一版那种 `case` 分支、
  `npm version patch`、`npm pkg set version=`、直接改清单那一行，以及「把真文件改坏一处」——四类都得红）。
- 它接进 `npm run check:release`，所以每次 `npm test`（先 build）与发布前都跑一遍。
  为什么必须这样：**跑一次 `release.yml` 只能在 `main` 上 dispatch**，规则得能在日常测试里判。

## 影响与回滚

- **对已发布产物**：只动 `.github/workflows/release.yml`、版本号与文档/测试；行为面零变化。
- **对工作流**：发布命令简化成 `gh workflow run release.yml`；换版本线改在本地 `npm version`。
- **回滚**：一次 `git revert`（版本号那次改动与 workflow 那次在同一条链上，回滚时注意
  别把号退回已发布的 `alpha.0`）。
- **两仓一致**：`dsh-ds-balance` 本来就是版本驱动，本仓这次是**跟上**，不是发明新语义。
