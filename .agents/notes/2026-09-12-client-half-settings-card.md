# 决策：用客户端半体承载设置卡片（2026-09-12）

已实施。取代 [密钥配置走原生插件配置表单](2026-09-12-secret-config-via-native-plugin-form.md)。

## 问题

Host 侧已调用 `ctx.settings.installSection` 且 `Config.accessSecret` 带 `role('secret')`，
但重启后「设置 → 插件 → 插件配置」里没有本插件。需要判定这是配置问题还是机制问题。

## 决策

判定为机制问题，按官方 cookbook 补齐浏览器半体：

- `src/client/index.tsx` 向 `settings.plugin.item` 注册 `key: 'zhihu-search'` 的卡片，
  经公开的 `ctx.settingsScope` 读写，样式只用 `--dsw-alias-*` 语义令牌。
- `scripts/build-client.mjs` 用 esbuild 生成 `window.__ModuleLoader__.load({id, factory})` 信封，
  外部化 react / react-dom / `@deepseek-ai/*`。
- 包清单声明 `dsh.client`（`platform: 'web'`）并提供 `./client` 导出。
- Host 侧的数据层契约不变：`installSection` + `role('secret')` 原样保留。

关键依据（DSH 源码与文档）：

- `packages/client/ui-settings-plugins/src/client/tab-store.ts:6-7,89-91` —— 面板取「已服务命名空间 ∩ 已注册卡片」的交集，无回退。
- `packages/client/ui-settings-plugins/README.md:32,96` —— 同一结论的文档版，并明写「卡片仍需要浏览器 bundle」。
- `docs/cookbook/adding-a-settings-card.md:5,48-70,82,94-102` —— 官方路径与最小骨架；并明写 `clientBundle` 预设未发布，仓库外必须自行复现打包格式。
- `packages/web/web-search-deepseek/src/` —— 该官方包**没有** client 半体，其卡片硬编码在 DSH 自己的 `ui-settings-plugins` 里，属第一方特权，不可照搬。

## 替代方案

- **只保留 Host 半体**：即本次要修的状态。实测确认不显示，源码侧根因是无卡片即不渲染。
- **复用官方卡片构件（`PluginCard` / `SecretField` / `card-form`）**：`ui-settings-plugins` 的运行时导出只有 `apply`/`inject`（构件全是 `export type`），且跨插件值导入被 bundle-purity gate 拒绝。
- **照抄 `web-search-deepseek`**：它没有 client 半体可抄；卡片在 DSH 仓库内，第三方无法在其仓库外复刻。
- **用 tsdown + 官方 `clientBundle` 预设**：该预设位于仓库内 `packages/client/tsdown.client.ts`，未发布到 npm。

## 影响

- 依赖面增加：peer/dev 增加 react、react-dom、`@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-settings-plugins`（后三者按红线 1 只在 peer + dev）。
- 构建面增加一步 esbuild；`link:` 安装下改客户端代码必须重新 build。
- 打包格式由本项目自行复现，DSH 升级时需回归 `test/client-bundle.test.ts`。
- 已知取舍：卡片只用 `--dsw-alias-*` 内联样式，未接 DSH 的 locale 字典（官方要求文案进字典），英文界面下卡片文案仍为中文。
