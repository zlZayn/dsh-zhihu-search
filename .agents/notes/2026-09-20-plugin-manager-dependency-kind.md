# plugin-manager 的依赖形态：类型面必需、运行时不必需 → 只留 dev

## 问题

`@deepseek-ai/dsh-client-ui-plugin-manager` 同时声明在 `peerDependencies` 与 `devDependencies`，
但它**在 npm 上没有 `next` 版本**（只有 `latest` 与 `alpha`）。按换包巡检的判定
（peer 里点名的包在某条线上没有版本 → 失败），`next` 线会因为它而红 ——
而症状看起来像安装 / peer 冲突，不是"这个包没发到那条线"。

先要回答的是：它到底是不是运行时依赖？

## 事实（本次实读）

- 全仓搜索该包名，**源码里唯一的引用**是 `src/client/index.tsx:31` 的
  `import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';` ——
  **空花括号 + `type`**：不导入任何值，编译后整行消失。**不是运行时依赖。**
- 但它**不是装饰**：该包带 module augmentation，安装目录里
  `lib/types/client/index.d.ts` 有 `declare module '@deepseek-ai/dsh-client-ui-slots' { … }` ——
  正是它把 `plugins.bundle.config` 槽键合进 SlotMap。源码注释也写着「类型导入即声明」。
- 运行时关系本来就不靠 peer：`package.json` 的 `dsh.client.inject` 已经声明了它，
  那是浏览器半体的装载顺序契约。

## 决策

**从 `peerDependencies` 移除，保留在 `devDependencies`。**

1. 运行时关系由 `dsh.client.inject` 表达，peer 是重复声明。
2. 类型面仍需可解析（否则 `tsc` 报 TS2307），dev 覆盖这一点。
3. 本仓的换包判定**本来就是分档的**（`scripts/compat-swap.mjs`：peer 缺失 = 失败；
   仅 dev 缺失 = 告警并跳过），所以这一步立刻让 `next` 线不再因为这个包而红。

`dsh-ds-balance` 同批同选（同一个上游事实，两仓不能一个说法）。

## 替代方案

- **保留 peer + `peerDependenciesMeta.optional: true`** —— 可行，但语义绕一层：
  "宿主应提供"与"缺了也不算错"同时表达，而运行时本来不用它。
- **保留现状，在 compat 里记成"上游未就绪"的已知例外** —— 否。每周红靠豁免消化，
  等于把判定从"事实"降级成"人记得"。
- **连 dev 一起删** —— 否。`import type {}` 也要能解析模块，删了 `tsc` 直接挂。
- **删掉 `import type {}` 那行** —— 否。删了就丢了槽键的类型契约，
  注册 `plugins.bundle.config` 时类型不再被检查。

## 影响

- 红线「上下文相关包全部在 peerDependencies 与 devDependencies」锁的是
  `cordis` / `dsh-tools` / `schemastery` 三个，不含本包，所以断言不需要改。
- 若上游把它发到 `next`，把 dev 声明抬上去即可，**不需要恢复 peer**。

## 补记（2026-09-22）：这条规则需要**两类判据**，本文只写了第一类

本文的判据是「**我们只 import type → 只写 dev**」。它是对的，但**不是全部** —— 有人（本轮）照它去删
`@deepseek-ai/dsh-client-ui-settings` 的 peer 时才发现：**规则解释不了现状**，而「规则与现状对不上」
正是下一个人会照规则动手的原因。

### 两类判据（判的是**我们与它的关系**，不是它住在哪一侧）

| 我们与它的关系 | 声明 | 本仓实例 |
|---|---|---|
| 只做类型面（module augmentation）、我们只 `import type` | **只 `devDependencies`** | `dsh-client-ui-plugin-manager`（本文）、`cordis-plugin-loader` |
| **我们消费它提供的服务**（运行时） | **必须 `peerDependencies`** | `dsh-client-ui-settings`、`dsh-client-ui-slots`、`dsh-credentials`、`dsh-settings` … |

### 为什么 `dsh-client-ui-settings` 属于第二类（**源码里一行 import 都没有**）

- 它**不是只出类型的包**，它是宿主服务 **`configForms` 的提供方**：
  `deepseek-harness/packages/client/ui-settings/src/client/config-form.ts:241` → `export class ConfigForms extends Service`；
  同文件 `:266` → `super(ctx, 'configForms')`。
- 本仓卡片经 `ctx.configForms.get(<loader entry id>)` **属性访问**这个服务（`src/client/index.tsx:109`），
  形状在本目录以结构类型就地收窄（`ConfigFormsFace`，同文件 `:323`）—— 所以**没有类型边，但有运行时边**。
- 它留在 `devDependencies`，真实理由是「`plugin-manager` 的 `.d.ts` 里 `import type … from '@deepseek-ai/dsh-client-ui-settings/client'`」
  （`node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/lib/types/client/slot-contract.d.ts:18`、`manager-store.d.ts:13`）——
  **那是别人 `.d.ts` 的解析需要，不是「我们只 import type」**。两件事别混。

### 本文第一类判据为什么在那种情况下仍成立

plugin-manager 能只留 dev，靠的是**有替代机制**：运行时关系写在 `dsh.client.inject` 里
（本文「决策」第 1 条的原话）。**ui-settings 没有这个替代** —— `dsh.client.inject` 里只有 plugin-manager。
所以删掉它的 peer 之后，「宿主必须提供 `configForms`」在清单里**再无处可写**。

### 那三条例行断言为什么拦不住

[test/redlines.test.ts](../../test/redlines.test.ts) 的三条（`peer ↔ dev 版本一致`、`上下文相关包名单`、`声明面自洽`）
**都不覆盖「服务提供方是否被声明」**：删掉 peer 它们照样全绿。**所以「全绿」不能当作这类改动的判据**，
就像「测试全绿」不能当作「宿主兼容」的判据（见根 `AGENTS.md` 的验证快照）。

### 顺带记下一条更贵的教训

本轮动手的由头是一条挂起项写着「两仓对 `dsh-client-ui-settings` 的依赖类别不一致（balance 只留 dev）」——
**现查是错的**：balance 的 `peerDependencies` 与 `devDependencies` 里**都有**它（`package.json:78` 与 `:96`），
`git log -S` 显示从工程骨架那次提交起就在。**两仓从第一天起就一致，那个「不一致」从来不存在。**

「A 有、B 没有」这类**对比型断言同时依赖两边的状态** —— 任何一边变了它就陈腐，而它**读起来像事实**，
会被一层层复述下去（Lead 照着它派活、执行者照着它复述，**没人去看那份 `package.json`**）。
**对比断言要么写成可现查的判据，要么动手前现查一次。**
