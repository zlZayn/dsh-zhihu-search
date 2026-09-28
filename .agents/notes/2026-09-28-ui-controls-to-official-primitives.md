# 决策：配置卡片控件换官方 primitives（2026-09-28）

状态：生效
日期：2026-09-28

## 问题

审计（根工作区 `ui-primitives-audit.md`）确认：本仓配置卡片的 4 个自绘控件（密钥框、引用名框、重置、保存）
是 0.1.6 时代官方卡片形态的复刻。2026-09-22 声明下限抬到 `>=0.1.7-alpha.1`
（见 [2026-09-22-declaration-floor-moves-to-alpha.md](2026-09-22-declaration-floor-moves-to-alpha.md)）之后，
官方 `primitives` 已导出 `Input`、`Button` 与 settings-form 全家——原「官方卡片构件 type-only / 下限无此 API」
的约束（[2026-09-12-client-half-settings-card.md](2026-09-12-client-half-settings-card.md)）已解除，控件没有回头。

## 决策

- 密钥框与引用名框换官方 `Input`（原生属性直通，掩码 / 只读 / disabled 语义保留）；
  重置换 `Button variant="ghost" size="sm"`；保存换 `Button variant="primary"`。
- 移除随之失效的内联样式（`S.input` / `S.reset` / `S.save`）与 `dimStyle` 帮助函数；
  行布局（label / badge / hint 的排布）仍是内联样式，取值只用 `--dsw-alias-*` 语义令牌。
- 测试替身（`test/client-bundle.test.ts` 的 `PLATFORM_STUBS`）更新为产物实际访问的四个成员
  （`Button` / `Input` / `Switch` / `Tag`），删掉 0.1.6 时代已不存在的图标名 `IconChevronDownOutline14`。
- 红线纪律：不动 `dsh.client.inject`、不动 `engines.dsh`、不动任何 `@deepseek-ai/dsh-*` 依赖范围。

## 替代方案

- **换 `SettingsSecretField` / `SettingsValueField`**：官方 settings-form 行组件，语义更专（掩码 / 字段协议），
  但会改变行内 DOM 结构与标签排布，超出本次「直通转发」范围，留待后续单独评估。
- **保持现状**：约束已解除，没有继续手写的理由。

## 影响

- 用户可见：输入框 / 按钮外观与官方原语对齐（原几何本就逐条抄自官方，变化细微）；disabled 态改由官方 CSS 处理。
- 兼容：`engines.dsh` 不变；所用导出在 0.1.7-alpha.1（本仓下限）即全部存在，无兼容影响。
- 验证：`npm run build` 通过；`npm test` 310/310 通过；`npx vitest run test/redlines.test.ts` 21/21 通过。
- 发布：2.0.0 → 2.0.1（patch，档位判定见 docs/PUBLISHING.md 的问题链）。
- **settings-card 截图待补**：README 的 `assets/settings-card.png` / `settings-card_en.png` 需在 bump 后重拍，本轮未拍。
