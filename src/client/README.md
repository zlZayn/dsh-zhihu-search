# client/ — 浏览器半体

- 职责：在「设置 → 插件 → 插件配置」里渲染「知乎搜索」卡片。设置段只承载凭据引用名与开关；**密钥经 `ctx.remote.credentials` 写进凭据存储**（`$DSH_HOME/.credentials.yaml`），不经过设置文档。
- 文件索引：`index.tsx` 卡片本体与注册；[credential-store.ts](credential-store.ts) 凭据状态源（纯逻辑，无 React）；[locales.ts](locales.ts) 中英字典，并导出 `LOCALE_NS`、`ZhihuLocaleKey` 与 `LocaleNamespaceMap` 增强声明（key 拼错或漏一种语言即编译错误）。
- 关键导出：`apply`（注册字典与卡片）、`inject`（`['slots', 'settingsScope', 'remote', 'remote.credentials', 'locale']` —— **`remote` 与 `remote.credentials` 缺一不可**，理由见 [AGENTS.md](AGENTS.md)）、`createCredentialStore`（纯函数，跟踪引用名当下的配置状态）。
- 被谁依赖：DSH Web 的客户端模块系统按包清单的 `dsh.client` 扫描并加载 `lib/client.js`。
- 改后必测：`npm test` 的 [产物契约](../../test/README.md)（信封 id、导出面、inject 装配、注册 key）与 [credential-store 单测](../../test/credential-store.test.ts)。

## 视觉与结构

对齐官方插件卡片（DSH `ui-settings-plugins` 的 `PluginCard.tsx` + `fields.tsx`）：

- 可折叠头部：名称 / 说明 / 「未保存」标记 / 折叠箭头；展开后卡片改用 `bg-layer-2` 与 `label-dimmed` 边框。
- 字段行：标签 + 状态标记（`Tag`）+ 重置；说明行在控件下方，Access Secret 的说明里带一个「知乎开放平台个人中心」外链（新开页）。字段之间以 `border-l2` 分隔。
- 说明行里的外链只用 `--dsw-alias-link` 令牌；卡片是纯内联样式、写不了 `:hover`，因此常驻下划线作为静态可点提示。
- 底部：失败诊断 + 「放弃」+「保存」；保存成功且 Host 回读确认后才折叠。
- 取值逐条抄自官方 `PluginCard.module.css` 与 `fields.module.css`，只用 `--dsw-alias-*` 令牌。
- 开关行（「隐藏原生网页搜索」）用官方 `Switch`（同在 `ui-primitives`），行布局抄官方 `SubagentModelSelectionCard.module.css` 的 `.toggleRow` / `.toggleLabel`，外观因此与官方卡片同款；其下再一行**状态行**随开关换文案（同官方写法），让用户不必从开关位置反推它做了什么。
- 文案全部取自 [locales.ts](locales.ts) 的字典，组件不写死字符串。字典把命名空间合并进 `LocaleNamespaceMap`，key 拼错或漏一种语言都是**编译错误**。

`Tag` 与折叠图标来自 `@deepseek-ai/dsh-client-ui-primitives`。它是外壳预置模块（`PLATFORM_MODULES`），不是别的插件，因此可以直接用，不需要 `dsh.client.inject` 边。

`ctx.remote` 走**结构类型**而不是 `import type {} from '@deepseek-ai/dsh-api-remotes/client'`：那是客户端的装配包，只为声明它就把整包加进 `peerDependencies` 不划算，而本卡片只碰 `credentials` 一个命名空间。写法与 Host 侧取 `logger` 同款。

## 变更影响路由

- 改 `index.tsx` 的注册 key → 必须与 Host 侧 `ZHIHU_SETTINGS_NAMESPACE` 逐字一致，否则卡片不被分派；同步 [src/README.md](../README.md)。
- 改 `inject` 声明 → 同步 [test/client-bundle.test.ts](../../test/client-bundle.test.ts) 的导出面断言，并跑「按真实 Cordis 语义装配」组（**唯一**能看见 inject 门禁的地方）。`remote` 让 `ctx.remote` 属性访问合法、`remote.credentials` 等命名空间就绪，两个都不能删。
- 改 `credential-store.ts` → 跑 [test/credential-store.test.ts](../../test/credential-store.test.ts)。两条不可弱化：**引用名一换旧答案立即作废**（徽标说谎比徽标迟到更糟）、**写失败必须抛**（安静停在「未配置」会让用户以为保存成功了）。
- 改样式 → 只用 `--dsw-alias-*` 语义令牌，不写字面色值。
- 加文案 → 只改 [locales.ts](locales.ts) 的 key 与两份字典；两处都补齐才编得过。
- 改 locale 命名空间 → 必须与槽位注册的 `locale:` 一致，否则 `t` 取不到值、界面显示 key 本身。
- 改完必须 `npm run build`。客户端半体由 `dsh-client-hmr` 轮询 `lib/client.js` 就地换装；**host 半体换不了** —— 本机 profile 装的是版本化 registry 副本（不是 `link:`），生效链是 build → 发版 → `dsh plugin --profile web add dsh-zhihu-search@<ver>` → 重启 → 见 [../AGENTS.md](../AGENTS.md) 的活跃坑。

## 参考

- 卡片为何必须存在 → 见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「两半体约束」
- 密钥为何不写设置文档 → 见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「密钥解析契约」
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
