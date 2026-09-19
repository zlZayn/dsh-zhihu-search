# client/ — 浏览器半体

- 职责：在侧边栏「插件（Plugins）」→「已安装（Installed）」组 → 本插件详情页里渲染「知乎搜索」配置卡片（槽 `plugins.bundle.config`，`key` 取本包包名）。设置段只承载凭据引用名与开关；**密钥经 `ctx.remote.credentials` 写进凭据存储**（`$DSH_HOME/.credentials.yaml`），不经过设置文档。
- 文件索引：`index.tsx` 卡片本体与注册；[credential-store.ts](credential-store.ts) 凭据状态源（纯逻辑，无 React）；[locales.ts](locales.ts) 中英字典，并导出 `LOCALE_NS`、`ZhihuLocaleKey` 与 `LocaleNamespaceMap` 增强声明（key 拼错或漏一种语言即编译错误）。
- 关键导出：`apply`（注册字典与卡片）、`inject`（`['slots', 'settingsScope', 'remote', 'remote.credentials', 'locale']` —— **`remote` 与 `remote.credentials` 缺一不可**，理由见 [AGENTS.md](AGENTS.md)）、`createCredentialStore`（纯函数，跟踪引用名当下的配置状态）。
- 能力探测：`plugins.bundle.config` 槽缺席（更早的宿主）时 `ctx.slots.inject` 的回调不会来，界面静默缺席 —— 注册处因此带一个超时窗口，超时后往**客户端控制台**写一条英文 WARN 提示；槽迟到则补一条 INFO 撤销它。只加提示路径，注册的槽名 / key / 时机一字不改，探测失败不影响任何既有功能。
- 被谁依赖：DSH Web 的客户端模块系统按包清单的 `dsh.client` 扫描并加载 `lib/client.js`。
- 改后必测：`npm test` 的 [产物契约](../../test/README.md)（信封 id、导出面、inject 装配、注册 key）与 [credential-store 单测](../../test/credential-store.test.ts)。

## 视觉与结构

对齐原生配置表单（DSH `ui-settings-plugins` 的 `PluginConfigForm.tsx` + `fields.tsx`）：

- 不可折叠、没有标题、**没有外框**：标题与面包屑由插件页自己画，一列控件直接落在插件页的 `data-plugin-config` 区里（无 border / 圆角 / 底色 / 内边距）。
- 字段行：标签 + 状态标记（`Tag`）+ 重置；说明行在控件下方，Access Secret 的说明里带一个「知乎开放平台个人中心」外链（新开页）。字段之间以 `border-l2` 分隔。
- 说明行里的外链只用 `--dsw-alias-link` 令牌；组件是纯内联样式、写不了 `:hover`，因此常驻下划线作为静态可点提示。
- 底部：失败诊断（`role=status`，占满剩余宽度）+ **单一保存按钮**（无分割线、左对齐）；disabled = 无改动 / 不可写 / 保存中。草稿随卸载丢弃，因此没有「放弃」控件。
- 取值逐条对齐官方 `PluginConfigForm.module.css` 与 `fields.module.css`，只用 `--dsw-alias-*` 令牌。
- 开关行（「隐藏原生网页搜索」）用官方 `Switch`（同在 `ui-primitives`），行布局抄官方 `SubagentModelSelectionCard.module.css` 的 `.toggleRow` / `.toggleLabel`，外观因此与官方卡片同款；其下再一行**状态行**随开关换文案（同官方写法），让用户不必从开关位置反推它做了什么。
- 文案全部取自 [locales.ts](locales.ts) 的字典，组件不写死字符串。字典把命名空间合并进 `LocaleNamespaceMap`，key 拼错或漏一种语言都是**编译错误**。

`Tag` 与 `Switch` 来自 `@deepseek-ai/dsh-client-ui-primitives`。它是外壳预置模块（`PLATFORM_MODULES`），不是别的插件，因此可以直接用，不需要 `dsh.client.inject` 边。

`ctx.remote` 走**结构类型**而不是 `import type {} from '@deepseek-ai/dsh-api-remotes/client'`：那是客户端的装配包，只为声明它就把整包加进 `peerDependencies` 不划算，而本卡片只碰 `credentials` 一个命名空间。写法与 Host 侧取 `logger` 同款。

## 变更影响路由

- 改 `index.tsx` 的注册 key（`BUNDLE_NAME`）→ 必须与 [package.json](../../package.json) 的 `name` 逐字一致，插件页按包名取配置，写错即整块不出现且不报错；同步 [src/README.md](../README.md)。改槽位名同理。
- 改 `inject` 声明 → 同步 [test/client-bundle.test.ts](../../test/client-bundle.test.ts) 的导出面断言，并跑「按真实 Cordis 语义装配」组（**唯一**能看见 inject 门禁的地方）。`remote` 让 `ctx.remote` 属性访问合法、`remote.credentials` 等命名空间就绪，两个都不能删。
- 改 `credential-store.ts` → 跑 [test/credential-store.test.ts](../../test/credential-store.test.ts)。两条不可弱化：**引用名一换旧答案立即作废**（徽标说谎比徽标迟到更糟）、**写失败必须抛**（安静停在「未配置」会让用户以为保存成功了）。
- 改样式 → 只用 `--dsw-alias-*` 语义令牌，不写字面色值。
- 加文案 → 只改 [locales.ts](locales.ts) 的 key 与两份字典；两处都补齐才编得过。
- 改**渲染面**（文案值、JSX 结构、样式对象、可见状态）→ **必须同批重截** [assets/](../../assets/) 的两张卡片图；触发判据、步骤与验收见 [assets/AGENTS.md](../../assets/AGENTS.md)。
- 改 locale 命名空间 → 必须与槽位注册的 `locale:` 一致，否则 `t` 取不到值、界面显示 key 本身。
- 改探测窗口或提示文案 → 跑 [产物测试](../../test/client-bundle.test.ts) 的「配置槽能力探测」一组（三条：按时到达不发声 / 缺席时恰一条英文提示 / 迟到时撤销），并同步根 [README.md](../../README.md) 的「版本兼容」。
- 改完必须 `npm run build`。客户端半体由 `dsh-client-hmr` 轮询 `lib/client.js` 就地换装；**host 半体换不了**。
  生效链**取决于本机 profile 怎么挂的**（先 `Get-Item <profile>\node_modules\dsh-zhihu-search | Select LinkType,Target`）：符号链接到仓库时构建**直接写线上浏览器半体**；版本化副本则要 build → 发版 → `dsh plugin --profile web add dsh-zhihu-search@<ver>`。两种模式下 host 半体都要重启 → 见 [../AGENTS.md](../AGENTS.md) 的活跃坑。

## 参考

- 卡片为何必须存在 → 见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「两半体约束」
- 密钥为何不写设置文档 → 见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「密钥解析契约」
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
