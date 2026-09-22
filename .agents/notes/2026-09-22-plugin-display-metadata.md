# 插件展示元数据：名字与描述进包，图标**不加**

> **本文「图标：这一轮不加」那一节已被取代**（2026-09-22，同一轮稍后）：用户拍板两仓都加图标，
> 包根因此新增 `icon.svg`（取自 `assets/logo.svg` 里那只蓝色方标）并由 `package.json` 声明。
> 取代它的是[插件图标：把 `assets/logo.svg` 里那只蓝色方标烘进 36×36 的 `icon.svg`](2026-09-22-plugin-icon.md)；
> 本文其余部分（名字与描述、判定为什么落成守卫、定档 patch）**仍然有效**，故正文一字未改。

**一轮之内给本插件补上宿主界面里的显示名与描述，这是它的决策记录。**
机制一律回 DSH 源码核（工作树 = tag `dsh-v0.1.7-alpha.1` = `c36a83ff6b`），不凭文档推断。

## 问题

用户看到官方 bundle 在插件页显示**本地化的标题 / 描述 / 图标**，问我们的插件能不能照做 —— 能。
本插件当时在插件页与设置里显示的是**技术名**（`dsh-zhihu-search` / 短化后的 `zhihu-search`），
bundle 详情页标题下那句描述**是空的**。它不影响功能，只影响门面：
一个中文使用者看不出它是干什么的。

## 机制（回源码核过）

三条，出处都是 DSH 自己的实现，不是推断：

1. **资源怎么被找到**：宿主按**插件名做 Node 资源解析**读 `<插件名>/locale/en.json`，
   再读同目录下的其余 `.json`；`<插件名>/package.json` 供回落与图标声明。
   全部经 `exports` 走，**不执行插件代码**（禁用、加载失败、预设里的条目因此也能显示）。
   出处：`packages/boot/app-boot/src/package-meta.ts` 的 `readPluginMeta`（`:148-171` 是入口，
   `:101-122` 是语言目录发现，`:21-41` 是图标读法）；bundle 层的调用点
   `packages/boot/plugin-manager/src/index.ts:262`（`readPluginMeta(info.name ?? name, …)`）。
2. **回落链逐字段独立**（原文：`localizedText` `:124-133`）：
   - 标题 `meta.title` → `package.json` 的 `name` → **完整 Cordis 插件名**；
   - 描述 `meta.description` → `package.json` 的 `description` → **不显示**。
   `en.json` 是**发现入口**：没有它，其余语言文件一个都不会被读。
   **字段必须是「非空字符串」**（`textOf` `:81-85`）—— 空白串不是「没写」，是**报错**：
   宿主返回一条 per-plugin 诊断并**保留**回落文案。所以文案不能靠留空来表示「不显示」。
3. **显示点**：插件页的 bundle 卡片与详情页走 `packageText`（`packages/client/ui-plugin-manager/src/client/presentation.ts:96-104`），
   详情页把它画在标题（`:568`）与包名（`:574`，`data-plugin-name`）之间、描述那行（`:575`）；
   设置里的插件清单同样用它，且**只**对技术名回落做短化（`dsh-` / `cordis:` 前缀），
   本地化标题**原样保留**（`packages/client/ui-settings-plugin-inventory/README.md:34`）。

官方样例是 `packages/experimental/agent-team-profile/`（bundle 层：`icon.svg` + `locale/{en,zh}.json`）
与 `packages/experimental/agent-team/`（组件行那一层，只有 `locale/`）。

## 决策

### 文案：只有一处真源

- 包根新增 [`locale/zh.json`](../../locale/zh.json) 与 [`locale/en.json`](../../locale/en.json)，
  各只有 `meta.title` 与 `meta.description` 两个字段，**取值自拟、面向使用者**：
  中文 `知乎检索` / `接知乎开放平台官方接口，给模型知乎站内检索、全网检索与直答三种能力。`；
  英文 `Zhihu Search` / 与之逐字对应的英文一句。
- **其它文件一律不复制这两句**（含根 README）：一个事实一个 home，抄一份就有两处会漂。
  根 [AGENTS.md](../../AGENTS.md) 的全局规则因此加了一条，README 只留指针。
- `package.json` 的 `description` 与 `locale/en.json` 的 `meta.description` **逐字同内容** ——
  它不是三处文案里的第三处，而是**回落链的中间那一档**：英文界面万一读不到 locale 时显示的就是它。
  两档讲两套话不会报错，所以由 [test/plugin-metadata.test.ts](../../test/plugin-metadata.test.ts) 钉住。

### 随包与可解析：落成守卫，不写散文

三条里缺任何一条宿主都**不报错**（只是退回技术名），所以判成「必须落成校验」那一类：

- `files` 收录 `locale/*.json`；
- `exports` 暴露 `./locale/*.json`（缺它 → `ERR_PACKAGE_PATH_NOT_EXPORTED` → 静默回落）
  与 `./package.json`（回落链的中间档与图标声明都经它读）；
- `meta` 两个字段非空、文件名是合法语言 id。

判定只有一处：[scripts/plugin-metadata.mjs](../../scripts/plugin-metadata.mjs)。
`npm run check:release`（发布前跑）与 [test/plugin-metadata.test.ts](../../test/plugin-metadata.test.ts)
读**同一份** —— 守卫与测试各写一套的话，「红只红一边」本身就是新的漂点。
测试带**反向控制**（临时仓副本，每次只改一处）：
漏 `files`、少任一 `exports` 条目、字段写成空白、JSON 写坏、文件名不是语言 id、`icon` 越界 —— 逐条都得红；
以及「改一处不该让别的条目跟着红」这条反向的反向。

### 图标：**这一轮不加**（这是决定，不是遗漏）

图标是**可选字段**（顶层 `"icon": "./icon.svg"`），本仓**没有可用的图标资产**，而约束是硬的：

- 路径**相对声明它的清单**解析，且 realpath 之后必须**留在该目录内** ——
  所以现成的 `assets/logo.svg`（523×346 的「DSH 知乎检索」字标，15 KB）**用不了**：
  写 `./assets/logo.svg` 会被判「必须留在清单目录内」而拒（宿主只留一条诊断，其余文案照常显示）。
- 要用就得在**包根**新增一个文件。而字标不是图标：图标要的是小尺寸下认得出的方形标记，
  仓库里没有这样一个资产，硬造等于**替维护者定视觉方向** —— 那是他的决定，不是执行者的。
- 判据同根 [assets/AGENTS.md](../../assets/AGENTS.md)：「拿不准时按『必须重截』办」的对偶版本 ——
  **拿不准就别加**：不加的代价是卡片用面板默认图（与今天完全一样），
  加错的代价是一个可能被否掉的资产进了 npm 产物，还得再发一版把它换掉。

**加图标要同时改五处**（**2026-09-22 同一轮稍后已全部做完**，取代本文这一节 → [图标记录](2026-09-22-plugin-icon.md)）：
包根新增自包含的 `icon.svg`（≤256 KiB）、
`package.json` 的 `icon`、`files` 收录它、
[assets/README.md](../../assets/README.md) 的「文件与引用面」补上它与「与发版的关系」，
并按 [assets/AGENTS.md](../../assets/AGENTS.md) 重截卡片图（图标直接改变卡片外观）。

### 定档：**patch**

按 [docs/PUBLISHING.md](../../docs/PUBLISHING.md) 的问题链逐问问（判例已同批写进那里的判例库）：

- **Q0 是** —— 已发布产物的**渲染文本**变了（插件页与设置里显示的不再是技术名，详情页描述从空变成一句），
  `files` 只增不减。守门的 [release-guard.mjs](../../scripts/release-guard.mjs) 也判它是产物改动（`locale/` 不在非产物前缀里）。
- **Q1 否**：旧版上正确的用法不因此变错。
- **Q2 否**：不需要改用法、不需要改配置或依赖声明。
- **Q3 否**：**不是新能力**，只是同一件东西显示得更清楚 —— 与「包元数据纠错（`keywords`、npm 页面描述）」
  那条判例同类。根 README 里「点哪个名字进详情页」那句话跟着改，属**描述同步**，不是新用法。

预发布线上按 SemVer 取整：本次带它的版本是 `2.0.0-alpha.1`。

## 影响

- **对使用者**：插件页与设置里显示 `知乎检索` / `Zhihu Search` 与一句描述；详情页标题下方仍留技术名
  `dsh-zhihu-search`（宿主刻意保留完整技术名，只有设置页做短化）。**行为、配置、工具一律未动。**
- **对截图**：两张卡片图的画面里多了标题与描述这两处 —— 重拍时它们是新的**判废项**
  （见根 [AGENTS.md](../../AGENTS.md) 的待办与 [assets/README.md](../../assets/README.md)）。
  卡片**本体**（字段、按钮、状态行、样式对象）一字未改，所以按 [assets/AGENTS.md](../../assets/AGENTS.md)
  的「什么时候必须重截」判据，这一轮**不**单独为它重截。
- **对文档网络**：新增顶层目录 `locale/` 与新增脚本 `scripts/plugin-metadata.mjs`，
  同步点已按各子目录 README 的「变更影响路由」逐条走完
  （[scripts/README.md](../../scripts/README.md)、[test/README.md](../../test/README.md)、
  [docs/PUBLISHING.md](../../docs/PUBLISHING.md) 的「打包内容」、[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
  的「两半体约束」、两份根 README 的「配置」节）。
- **回滚**：一次 `git revert`。没有迁徙、没有数据形态变化、没有 profile 改动、没有依赖变化。
  回滚后宿主退回显示技术名 —— 也正是今天的样子。
