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
