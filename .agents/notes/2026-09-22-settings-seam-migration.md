# 设置接缝迁移：从 `settingsScope` 到「行配置 + volatile 活引用」

**一轮之内改了整条客户端配置面，这是它的决策记录。** 事实核对一律回 DSH 源码
（tag `dsh-v0.1.7-alpha.1` = `c36a83ff6b`），不凭文档推断。

## 问题

宿主从 `0.1.6-alpha.2` 升到 `0.1.7-alpha.1` 之后，**两个功能全失效**，而且**一声不响**：

- 客户端半体 `inject` 里的 `settingsScope` 被删了 —— cordis 的 `inject` 是**激活门禁**，
  声明一个不存在的服务 = 整个 `apply` 不执行。用户看到的只是「插件 pending」。
- 宿主半体的 `settings.installSection` 不存在了 —— 类型面直接红。

## 四条实测出来的宿主事实（都不是文档里写的）

1. **`plugins.bundle.config` 槽还在**（`slot-contract.ts` 声明、`PluginManagerPage.tsx:584` 渲染），
   但渲染它时**不传 `form`**（`:500` 的 `plugins.row.config` 才传）。
   → 逼我们搬家的是「取不到读写面」，不是「槽被删」。**只改槽名没用。**
2. **只有 `.volatile()` 的字段进配置页**：`describe()` 走 `volatileForm(schema)`，
   而它对**根级包了 wrapper**（`z.transform` / `z.intersect` …）的 schema 返回 `undefined` →
   整个 entry 不进 describe → 卡片彻底不出现。所以「把跨字段校验留在 schema 里」= 把配置页杀掉。
3. **`schema.check()` 在 0.1.7-alpha.1 不存在**（`vendor/schemastery/src/index.ts` 全文无此成员）——
   官方 `docs/cookbook/adding-a-settings-card.md:30` 自己写错了。照它写会拿到不存在的 API。
4. 顺带：`ctx.on('loader/volatile-update', …)` 需要 `import type {} from '@deepseek-ai/cordis-plugin-loader'`，
   否则 TS2345（键不在 `keyof Events` 里）。官方同类写法见 `packages/experimental/speech-to-text/src/index.ts:6-7`。

## 决策

- **只注册 `plugins.row.config`**，key 逐字 `dsh-zhihu-search#dsh-zhihu-search`（= `package.json` 的 `name`
  + `cordis.patch.yml` 那条 insert 的 `id`）。旧槽不再注册：它拿不到 `form`。
- **卡片改吃座位 props 的 `form`**（`{ state, mutate }`），`form` 可能缺席 → 按「不可写」渲染，
  **复用既有的只读文案，不新增可见状态**。
- **两个字段变 volatile**：`accessSecretRef` 与 `disableNativeWebSearch`（schema 里 `.default()` 在 `.volatile()` **之前**，
  否则类型是 `Volatile<T | undefined>`）。`accessSecret` **绝不 volatile** —— 它结构上不能进表单。
- **能力探测保留，但重新定义成「卡片拿不到 `form`」**这一个真实故障：
  「槽在不在」不再是分水岭（旧槽还在），探测必须跟着卡片改槽 ——
  **说谎的探测比没有探测更坏**。`engines` 是 advisory，装到旧宿主不报错，这条提示仍有活干。
- **配置页策略走 `settings.configure({ auto: false }, ctx.fiber)`**，包在 `ctx.effect` 里：
  同一个 fiber 第二次调用会抛「already configured」，而 settings 服务换装时这个子作用域会重入。
- **`settings` 与 `credentials` 拆成两个平行的可选层**：从前凭据嵌在设置里是为了定死迁徙顺序，
  而设置文档没了，序不存在。
- **`migrate.ts` 瘦身成「组合配置单向迁徙」**：旧 `settings.yaml` 那半边是**结构性不可达**
  （宿主 `importLegacyDocument()` 按 section 名当 entry id 导入，而 `LEGACY_SECTION_ENTRIES` 只映射三个官方 section），
  `purge` 通道随之退场 —— 于是「先写后删」那条纪律变成结构性成立，而不是靠调用顺序保证。

## 影响

- `Config.accessSecret` 的 **redact 锚点作用没有保护对象了**（配置页只投影 volatile 字段），
  字段留下来只为「组合配置迁徙的入口」。理由已改写进 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的
  「`accessSecret` 为什么仍留在 schema 里」。
- **对使用者是一次配置入口变更**：入口从「插件详情页里的配置区」变成「那一行的 Configure 页」。
  发版档位按 [docs/PUBLISHING.md](../../docs/PUBLISHING.md) 的 Q1/Q2 判 —— 那是维护者的决定，本轮不改。
- **风险**：升级后原来的 `disableNativeWebSearch: true` 不会自动跟过来（它躺在 `settings.yaml.imported` 里，
  宿主按 entry id 导入且没有我们这一段）。默认 `false` ⇒ 原生网页搜索对模型重新可见。**发版说明与 README 必须写。**
- **真机验收未做**：插件当前没装在 profile 里，而 host 半体不热更。口径见
  [scripts/README.md](../../scripts/README.md) 与根 [AGENTS.md](../../AGENTS.md) 的待办。
