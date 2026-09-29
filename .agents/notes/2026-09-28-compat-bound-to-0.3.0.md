# 决策：兼容上界从 <0.2.0 挪到 <0.3.0（验证 DSH 0.2.0-rc.1 后放行）

状态：生效
日期：2026-09-28

## 背景

`engines.dsh` 与 18 条 `@deepseek-ai/dsh-*` peer/dev 区间此前统一是
`>=0.1.7-alpha.1 <0.2.0`——上界是本仓的既定策略：实测验证过最低下限，
上界排除下一个大版本。

2026-09-28 上游发布 `dsh-v0.2.0-rc.1`（npm dist-tag `next`）：
按声明面，zhihu 会在 0.2.0 宿主上被判不兼容。

## 验证（本地，官方源 registry.npmjs.org）

把 18 条区间临时改成 `>=0.2.0-rc.1 <0.2.0`（预发布段按 semver 落在 `<0.2.0` 内），
清旧树后裸 `npm install`，全部实装精确落在 0.2.0-rc.1，然后：

- typecheck（test + client 两个 tsconfig）：零错误
- 全量测试：309/310；唯一红项是「锁文件 resolved 必须指向官方源」——本机默认 registry
  是 npmmirror，临时重装的 lock 带了镜像源，属本地环境产物，与 rc.1 无关
- 逐项 diff 对照：Button/Input 零改动；DisclosureRow/Tooltip 纯新增可选 props；
  ui-slots/ui-settings/configForms 只 bump 版本号；primitives src 零删除

结论：代码层面与 0.2.0-rc.1 兼容，无 API 破坏。

## 改动

- engines.dsh 与全部 18 条 dsh 区间：`<0.2.0` → `<0.3.0`（下限不动）
- 版本 2.0.1 → 2.0.2（patch：范围放宽不改行为，按 PUBLISHING.md Q1/Q2）
- lock 用 `--registry=https://registry.npmjs.org/` 重生，满足「resolved 必须官方源」红线
- 未动：源码、README、engines 下限、dsh.client.inject

## 替代方案

- **维持 `<0.2.0` 不放行**：0.2.0 宿主上插件会被判不兼容，而本地实测（typecheck 零错 + 309/310 测试 + 逐项 diff 无 API 破坏）确认兼容——放行有依据。
- **不验证直接放宽**：上游 rc 可能带破坏性变更；本次先做完整本地验证再改区间。
- **去掉上界**：与本仓「上界排除下一个大版本、发布后验证再放行」的既定策略冲突（本次正是沿该策略执行）。

## 待办

- settings-card 截图待补（2.0.1 UI 控件换官方 primitives 时就欠着，本次仍未拍）。
- 实机视觉过 settings-card：本地验证只到类型与单测，0.2.0 宿主里的卡片观感
  仍需人工点一眼；若有视觉回退，另起 patch。
- 等 0.2.0 正式版发布后复核 next 线指向。
