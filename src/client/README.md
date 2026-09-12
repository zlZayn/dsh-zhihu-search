# client/ — 浏览器半体

- 职责：在「设置 → 插件 → 插件配置」里渲染 Access Secret 卡片，并通过公开的 `ctx.settingsScope` 读写。
- 关键导出：`apply`（注册卡片）、`inject`（`['slots', 'settingsScope']`）、`readConfigured`（纯函数，判断密钥槽位是否已有值）。
- 被谁依赖：DSH Web 的客户端模块系统按包清单的 `dsh.client` 扫描并加载 `lib/client.js`。
- 改后必测：`npm test` 的 [产物契约](../../test/README.md)（信封 id、导出面、注册 key）。

## 视觉与结构

对齐官方插件卡片（DSH `ui-settings-plugins` 的 `PluginCard.tsx` + `fields.tsx`）：

- 可折叠头部：名称 / 说明 / 「未保存」标记 / 折叠箭头；展开后卡片改用 `bg-layer-2` 与 `label-dimmed` 边框。
- 字段行：标签 + 状态标记（`Tag`）+ 重置；说明行在控件下方，Access Secret 的说明里带一个「知乎开放平台个人中心」外链（新开页）。字段之间以 `border-l2` 分隔。
- 说明行里的外链只用 `--dsw-alias-link` 令牌；卡片是纯内联样式、写不了 `:hover`，因此常驻下划线作为静态可点提示。
- 底部：失败诊断 + 「放弃」+「保存」；保存成功且 Host 回读确认后才折叠。
- 取值逐条抄自官方 `PluginCard.module.css` 与 `fields.module.css`，只用 `--dsw-alias-*` 令牌。

`Tag` 与折叠图标来自 `@deepseek-ai/dsh-client-ui-primitives`。它是外壳预置模块（`PLATFORM_MODULES`），不是别的插件，因此可以直接用，不需要 `dsh.client.inject` 边。

## 变更影响路由

- 改 `index.tsx` 的注册 key → 必须与 Host 侧 `ZHIHU_SETTINGS_NAMESPACE` 逐字一致，否则卡片不被分派；同步 [src/README.md](../README.md)。
- 改样式 → 只用 `--dsw-alias-*` 语义令牌，不写字面色值。
- 改完必须 `npm run build`：`link:` 安装下 DSH 直接读 `lib/client.js`。

## 参考

- 卡片为何必须存在 → 见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「两半体约束」
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
