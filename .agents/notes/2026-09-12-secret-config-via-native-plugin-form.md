# 决策：密钥配置走 DSH 原生插件配置表单，不自建客户端卡片（2026-09-12）

**已被取代**：源码调研证明该前提不成立 —— 面板没有通用表单回退，没有浏览器半体就一定不显示。
后续决策见 [客户端半体承载设置卡片](2026-09-12-client-half-settings-card.md)。本记录保留，用于说明当时为何这样判断。

## 问题

密钥需要一个用户可操作的填写入口。官方 `dsh-web-search-deepseek` 提供了一个可对照的实现，
但它同时维护一张自定义客户端卡片；本插件只有一个配置项，需要判断是否值得照搬。

## 决策

只保留 Host 半体，复用 DSH 原生的插件配置表单：

- `Config` 中 `accessSecret` 声明 `z.string().role('secret')`，`accessSecretRef` 声明 `role('credential-ref')`。
- `apply()` 调用 `ctx.settings.installSection(ctx, 'zhihu-search', Config, config, { setSource, onChange })` 注册设置命名空间。
- 密钥按 **凭据域 → 设置字面量 → 环境变量** 解析，逻辑抽到 [src/credentials.ts](../../src/README.md) 并单测。
- 缓存键只掺入凭据来源标识（引用名或字面量哈希前 8 位），不掺明文。

## 替代方案

- **自建客户端卡片**：曾按官方卡片形状实现到可打包（`window.__ModuleLoader__.load` 信封、esbuild cjs 输出、内联 DSW 设计令牌），随后回滚。
  否决理由：单个配置项的收益配不上一条浏览器端构建链路 —— 需要 React 组件、client 侧 peer 依赖面、以及只在浏览器里才能验证的失败模式。
- **只用 profile 配置文件承载密钥**：否决。密钥要以明文写进配置文件，且每次修改都要重载。
- **把密钥交给环境变量承载**：否决。可作为回落通道，但要求用户改 shell 环境并重启，不适合作为主路径。

## 影响

- 依赖面保持纯 Host：`peerDependencies` 只多出 `dsh-credentials` 与 `dsh-settings`。
- 未决：官方 0.1.5-rc.2 的 `dsh-client-ui-settings-plugins` 注释称「卡片由插件自带的浏览器半体贡献」。
  若真机确认该页不会自动渲染本命名空间的表单，则本决策需要退回，恢复客户端半体。
