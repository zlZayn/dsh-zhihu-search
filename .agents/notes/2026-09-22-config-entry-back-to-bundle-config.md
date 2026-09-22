# 配置入口回到 `plugins.bundle.config`：这是**恢复到已发布 alpha 的入口**，不是又一次变更

**一轮之内把配置入口从 `plugins.row.config` 换回 `plugins.bundle.config`，这是它的决策记录。**
事实核对一律回 DSH 源码（工作树 = tag `dsh-v0.1.7-alpha.1` = `c36a83ff6b`），不凭文档推断。

## 问题

用户实机使用后的原话：「这些插件配置页都在直接页面啊，并不是在 component 又要多点一下的，
我这个插件又不是要多个 components，真的不能模仿官方实现吗」。

当时的入口是「插件列表 → 点插件名 → 该插件**那一行的 Configure** → 行子页」＝ **两次点击**。
而官方插件管理页声明的槽里，有一个正是「一个 bundle 自己的配置，内联在它的详情页里」。

## 先纠正一条**输入事实**：这次根本不是「配置入口变更」

判据是 npm 与 git 的现状，不是本地 HEAD：

| 版本 | 客户端入口 | 说明 |
|---|---|---|
| npm `latest` = `v1.6.3` | `settings.plugin.item` + `settingsScope` | 上一代接缝 |
| npm `alpha` = `2.0.0-alpha.0`（= `ff0bfa8`） | **`plugins.bundle.config`** | **这就是 bundle.config 那一版** |
| HEAD（未 push、未发布） | `plugins.row.config` | 只存在于本地三个提交里 |

命令与输出：`npm view dsh-zhihu-search versions dist-tags --json` → `{"latest":"1.6.3","alpha":"2.0.0-alpha.0"}`；
`git describe --tags` → `v1.6.3-12-g4c2242a`。

**结论：把入口换回 `plugins.bundle.config`，等于让 HEAD 与**已发布的 alpha** 的入口一致。**
「入口改成 Configure 子页」这件事**从未到达任何使用者** —— 它只活在本地未发布的提交里。
发版档位的问题链（[docs/PUBLISHING.md](../../docs/PUBLISHING.md)）因此**不能按「配置入口变更」推**：
Q2「使用者是否必须改变用法」在入口这一维上是**否**。真正会到达使用者的是
「客户端半体在 0.1.7 上从 pending 变成能跑」（修复）。

## 三条承重的宿主事实（都回源码核过）

1. **`plugins.bundle.config` 渲染在 bundle 详情页内联**，位于描述与「包含的组件」之间：
   `packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx:584`
   `renderSlot('plugins.bundle.config', { view: 'page' }, { entryKey: pkg.name })`。
   门禁是 `configured={ledger.bundles.has(openPkg.name)}`（`:1269`），`config-ledger.ts:51-52,66` 的
   `bundles = keysOf('plugins.bundle.config')` —— **key = 包名**。
2. **它只渲染 `page`，且座位里没有 `form`**：契约原文「Bundle configuration renders only `page`」
   （`slot-contract.ts:12-16`、`:89-94`），渲染点只递 `view` 与 `entryKey`。
   对照 `:500`（`plugins.row.config`）与 `:455`（`plugins.item`）那两处**都多一个 `form`**。
   → 所以在这个槽上「槽在不在」**推不出**「拿不拿得到表单」，这条**两版同形**，是结构性的。
3. **取表单只有一条官方路**：`ctx.configForms.get(<loader entry id>)`。
   `ui-settings/src/client/config-form.ts:289-302` 的 jsdoc「@param entryId Unique Host plugin entry id」，
   实现体是 `new ConfigFormController(this.owner, { namespace: entryId }, …)` —— **namespace === entryId**。
   宿主侧同一约定：`packages/settings/settings/src/index.ts:315,326` 的 `ns: entry.options.id`。

**官方原文是支持本路线的**（不是「二选一」）：`slot-contract.ts:79-88` 的 `plugins.item` 声明

> OCCUPIED by the official settings pages, one companion package per host-plane namespace;
> **a bundle's configuration belongs in `plugins.bundle.config` or `plugins.row.config` instead.**

它排除的是**占用 `plugins.item`**（官方设置页的座位），并把 `plugins.bundle.config` 列为第一选项。
反过来说：正因为它把 `plugins.item` 划给官方，我们**不能**用「官方插件那种卡片」实现「直接页面」。

> **cookbook 的覆盖空白**：`docs/cookbook/adding-a-settings-card.md:42` 只说「Custom plugin pages receive
> form.state and form.mutate(…) from the Plugins page owner」—— 那句只对 `plugins.item` / `plugins.row.config` 成立，
> **全文没写 `plugins.bundle.config` 的页面怎么拿 form**。所以我们找不到官方先例：
> 全 DSH 只有 `packages/experimental/client-ui-voice-input` 注册这个槽，而它不取表单。
> 「`bundle.config` + `configForms.get`」是**没有官方测试背书**的组合 —— 因此真机验收不是可选项。

## 决策

- **只注册 `plugins.bundle.config`**，key = **包名**（`package.json` 的 `name`）。
  不再注册 `plugins.row.config`：那是「bundle 有多行、每行各有配置」的形态，本插件只有一行一份配置。
- **不给 `summary`**：该槽只渲染 `page`（`slot-contract.ts:12-16`，且全仓只有 `:584` 一处用该槽），
  所以 `locales.ts` 里的 `rowSummary` **连文案一起删掉** —— 留着就是一条谁都不敢删、也没人渲染的死文案。
- **表单自取**：嵌套 `ctx.inject(['configForms'], …)` 里 `ctx.configForms.get(ENTRY_ID)`，
  `ENTRY_ID` = `cordis.patch.yml` 那条 insert 的 `id`。类型用**结构类型**就地收窄
  （`ConfigFormFace`），**不引 `dsh-client-ui-settings` 的类型边** —— 那会把工作区待办 #3
  （两仓对该包的依赖类别不一致）从「与本次无关」变成「本次要顺手定」，而那是跨仓取舍。
- **`configForms` 走嵌套 `inject`，不进模块级 `inject`**：后者是**激活门禁**，
  把一个新版才有的服务写进去，会让更早宿主上的整个客户端半体 pending —— 字典、凭据订阅、
  探测连发声机会都没有。嵌套把降级限制在「卡片不注册」这一件事上。
- **快照所有权转到卡片**：`getSnapshot` + `subscribe` 走 `useSyncExternalStore`。
  挂在 row 槽时快照由页面在渲染期递进来、页面重渲染才是推进源；挂在这个槽上没有那条路，
  卡片必须自己订阅（DSH 保证快照引用在下次变化前稳定，`config-form-types.ts:40`）。
  **这是本次唯一的架构级行为变化**，已改写进 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「两半体约束」。
- **不用 `whileServed`**：它的语义是「有命名空间才有页面」，而我们要的是
  「没有命名空间也把卡片画出来、只是只读」—— 后者复用既有只读文案，比**静默消失**好。
- **能力探测改成盯「那条链上真正会断的两环」**，不是盯槽名（见下）。
- 卡片样式对象**一字未动**：官方输入/表单配方与它逐条相同，重拍的差因此只剩版本号与状态。

## 探测：为什么不能只把槽名换回去

仓库规则（[src/client/AGENTS.md](../../src/client/AGENTS.md)）的原话是「探测必须跟着卡片改槽，
否则它会在新宿主上报 available 而卡片其实在另一个槽 —— **说谎的探测比没有探测更坏**」。
但**照字面执行会得到一个说谎的探测**：在 `plugins.bundle.config` 上，
「槽到了」完全不能推出「拿得到 form」（上面第 2 条，两版同形）。

所以执行它的**意图**（盯「卡片拿不到 form」），把判据换成两个各自独立、各自可撤销的窗口：

| 环 | 判据 | 缺席时报 |
|---|---|---|
| 服务 | 嵌套 `ctx.inject(['configForms'], …)` 的回调来没来 | `SERVICE_MISSING_WARNING`：宿主没有客户端配置服务 |
| 槽 | `ctx.slots.inject('plugins.bundle.config', …)` 的回调来没来 | `SLOT_MISSING_WARNING`：宿主不渲染这个槽 |

约定沿用既有那套：不查版本号、英文、`[WARN]` 前缀、落客户端控制台、**迟到补一条 `[INFO]` 撤销**、
不改变注册语义。两条补充规则：

- **服务缺席时槽那一环不发声** —— 那时「槽在不在」还没到判的时候，报它是替另一环说话，
  而且一次超时会变成两条噪音。
- **「撤」的判据是那一环到没到，不是「注册有没有发生」**：服务到了而槽还没到时不撤。

## 新引入的**静默耦合点**（本轮唯一一个）

槽 key 取**包名**、`configForms.get()` 取 **loader entry id** —— 两个不同的东西，今天恰好同串。

- 改了 `cordis.patch.yml` 的 `id`：槽 key 仍然对得上（卡片照常出现），`get()` 却查不到命名空间
  → **卡片永远只读，且不报错**。
- 防线是 [test/settings-seam.test.ts](../../test/settings-seam.test.ts) 的「`configForms.get() 的实参`」一组：
  源码里的 `ENTRY_ID` 字面量与 patch 的行 id 逐字相等，且**调用点写的是常量而不是就地字面量**
  （否则第一条会变成空话）。

## 一处**误分类**的更正（写进这里免得后人重犯）

`test/settings-seam.test.ts` 的「已删机制」黑名单原先把 **`plugins.bundle.config` 与
`settingsScope` / `installSection` 并列**，注释里写的是「旧机制（`settingsScope` / `installSection` /
`plugins.bundle.config`）一旦被谁顺手写回来…」。**这是错的，而且正是它把这次回退挡在了门外**：

- `plugins.bundle.config` 在接缝换代前后的**两版宿主上都在座**，它是**合法槽**；
- 真正被这次回退换掉的是 `plugins.row.config`。

现在那条黑名单只剩 `settingsScope`（`installSection` 有单独一条断言），并加了一行注释说明
`plugins.bundle.config` **为什么不在名单里**。凡是「把一批名字并列成黑名单」的写法，
都该先问一句：这些名字**为什么**在黑名单里，理由是不是同一个。

## 影响

- **对使用者**：入口与已发布的 `2.0.0-alpha.0` **一致**（点插件名进详情页就是配置区）；
  真正的新东西是「客户端半体在 0.1.7 上真的能跑起来」—— 已发布的 alpha 因为 `inject` 里含已删的
  `settingsScope`，在 0.1.7 宿主上**整个半体不激活**，装过 alpha 的人现在没有配置入口。
- **声明面不变**：下限仍是接缝换代那一条（`engines.dsh` 见 `package.json`），
  但**理由要补全**：光有槽不够，还需要 `configForms`。
  [.github/workflows/release.yml](../../.github/workflows/release.yml) 顶部那段注释已按这个改。
- **重拍判据降级**：现有两张卡片图拍的**正是**这个入口形态，所以重拍更新的只是版本 tag 与状态；
  同时新增三条**判废项**（出现 Configure 控件 / 右向箭头 / `[data-plugin-row-detail]`）——
  有它们说明拍的是 row 槽那一版。
- **回滚**：一次 `git revert`。全是客户端 + 测试 + 文档，无迁徙、无数据形态变化、无 profile 改动。
- **真机验收未做**：口径见根 [AGENTS.md](../../AGENTS.md) 的待办与
  [scripts/README.md](../../scripts/README.md)。
