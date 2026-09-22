# 声明面下限：试过抬到 alpha 线，抬不动 —— 维持停在 next 线

> **已被取代（2026-09-22）**：本文件的**决策**（维持停在 next 线）作废 —— 声明面已整条抬到 alpha 线，
> 见 [2026-09-22-declaration-floor-moves-to-alpha.md](2026-09-22-declaration-floor-moves-to-alpha.md)。
> **正文一字不改**：它记录的是当时的事实（那天确实抬不动），那份事实仍然真实 —— 变的只是结论。

## 问题

`engines.dsh` 的下限是 `>=0.1.6-alpha.2`（引入 `plugins.bundle.config` 槽的那一版），
而清单里 **27 条**官方声明的下限停在 **next 线**（`^0.1.5-rc.2`）：9 条 `peerDependencies`
（同时也在 dev）+ 18 条只在 `devDependencies`。两份声明自相矛盾 ——
使用者按 peer 区间装出来的宿主，未必有我们声称需要的那个槽。

待办里挂着这条已经几天，原文的处置是"等 alpha 切到 next（或发正式版）时再放宽"。

## 事实（2026-09-20 实测，这次真去抬了一遍）

1. **依赖图解得开**：把 27 条抬到 `^0.1.6-alpha.2`、删掉旧锁文件重新解析后
   `npm install` 能把依赖装上 —— 全部官方包装到 alpha 线版本，新锁文件 134/134 条 `resolved` 指向官方源。
   （此前直接 `npm install` 报 ERESOLVE，是因为旧锁文件把 `dsh-tools` 等钉在 next 线版本上，
   而 next 线版本的 peer 又要求旧 `dsh-agent` —— 那是**旧树的解算顺序问题**，不是终点。）
2. **但构建过不去**：`npm run build`（`prepare` 会触发它）里 `tsc` 报

   ```
   src/index.ts(404,27): error TS2345: Type 'void' is not assignable to type 'Promise<undefined> | undefined'
   ```

   出问题的行是 `ctx.on('agent/created', ({ agent }) => { installOn(agent); })` ——
   alpha 线把该事件的 handler 签名收成了必须返回 `Promise<undefined> | undefined`，块体箭头（返回 void）不再可赋值。
3. **这不是新信息**：根 [AGENTS.md](../../AGENTS.md) 的「宿主兼容性」那条早就写着
   「**类型面会先于行为面动 —— alpha 线上类型面已红而 260 个测试全绿**」。
   也就是说 alpha 线是**已知类型面红的前瞻线**，`compat.yml` 里它的失败是**设计上不阻断**的。

## 决策

**维持现状：声明停在 next 线，不抬到 alpha 线。** 手头这批改动里，与"抬升"相关的一律回退
（`package.json` 的范围、两份 README 的「前置」）。

理由：`engines.dsh` 的下限与 peer 的下限**在语义上是两件事** ——
前者是"引入那个槽的版本"（历史事实，不能为迁就谁而下调），后者是"我们承诺支持并验证过的宿主线"。
**把未验证、且已知类型面红的前瞻线写进承诺面，等于让默认安装装不出来**；
而按本仓自己的判据（Q1/Q2），那还是一次 major。

## 替代方案

- **顺手改一行代码适配 alpha**（`src/index.ts:404` 的 handler 改成返回 `undefined` 或 async）——
  否。那等于**把插件挪到前瞻线**上：前瞻线还会继续动，承诺面就跟着漂；
  而且这次改的是"我们承诺的宿主范围"，不是顺手修一个类型。
- **用 `--legacy-peer-deps` / `--force` 强行装** —— 否。本仓 [PUBLISHING.md](../docs/PUBLISHING.md) 与
  活跃坑里明确写过 `--legacy-peer-deps` 会连 npm 的 peer 自动安装一起关掉，不是解药。
- **把 `dsh-code-runtime` 一起抬** —— 否，且它抬不了：它在 alpha 线上停在更旧的版本，
  声明抬上去就没有可装的版本（它是 dev-only 且无人引用，删掉那条待办时才一起收）。

## 影响

- 待办那条**保留**（原文的处置仍然有效），并补上这次的证据与"抬不动"的结论。
- 根文档「声明面应当自洽」这条规矩保留，但写明**此刻不能抬**及其触发条件。
- 备份：抬升前的 `package.json` 与 `package-lock.json` 都在 git 里（本次改动未提交前已 `git checkout` 还原）。
- 真正要盯的信号仍是 `compat.yml` 的 `declaration` 作业：它转红就是"声明面罩不住被跟的那条线"。
