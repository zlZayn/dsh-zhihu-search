# client/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

本目录特有约束：

- 禁止运行时 import 其他插件的值：跨插件只走 Cordis 服务，DSH 的 bundle-purity gate 会拒绝值导入。
- 只允许 `import type`（DSH 类型）与**外壳预置模块**的值导入。预置清单以 DSH `packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES` 为准 —— 由 seed 表解析，不需要依赖边。**不要在此抄一份**：原抄件漏了 `react-dom/client` 且混用简写，已删。
- 落在 `PLATFORM_MODULES` 之外的值导入必须同时写进 `dsh.client.inject` 与 `dsh.client.external`，否则工厂不会先到 → [docs/PUBLISHING.md](../../docs/PUBLISHING.md) 的「构建链的两个事实」。
- 只为一个类型引入新的 `peerDependencies` 不划算：客户端装配包（如 `dsh-api-remotes`）用**结构类型**在本目录就地收窄，写法见 `index.tsx` 的 `ClientRemoteFace` / `ConfigFormFace`。**槽声明是例外** —— 槽名由提供方合并进共享的 `SlotMap`，结构类型复制不出来，只能 `import type {} from '<包>/client'` 并保留那条边：现在它是 `dsh-client-ui-plugin-manager`（`plugins.bundle.config`，**只声明槽**，不再从它取任何类型）。**卡片刻意不欠 `dsh-client-ui-settings` 任何类型边** —— 表单是从 `ctx.configForms` 取的服务，形状在本目录以结构类型就地收窄。
- **槽 key 与 `configForms.get()` 的实参是两个不同的 id**：前者是**包名**（页面按它寻址一个 bundle 的配置），后者是 **loader entry id**（= 设置命名空间 = patch 那条 insert 的 `id`）。今天同串，改 patch 的 `id` 时槽 key 仍对、卡片照常出现，但 `get()` 查不到命名空间 —— **卡片永远只读且不报错**。两个字面量各自由 [test/settings-seam.test.ts](../../test/settings-seam.test.ts) 与声明文件对账。
- **`inject` 必须对齐真实的访问方式**：Cordis 的判据是「服务名**逐字**出现在某个 fiber 的 `inject` 里」，点号键**不展开**成父级。走 `ctx.remote.credentials` 属性链就要同时声明 `remote` 与 `remote.credentials` —— 只写后者不是降级，是整块装不上（`cannot get property "remote" without inject`）→ [复盘](../../docs/postmortem/2026-09-15-client-inject-remote-missing.md)。
- 改 `inject` 后必须跑 [产物测试](../../test/client-bundle.test.ts) 的「按真实 Cordis 语义装配」组：它是唯一能看见这道门禁的地方，普通替身（传普通对象当 `ctx`）结构性地看不见。
- **反过来同样致命：声明一个已删的服务**（`settingsScope`，接缝换代时被删）会让整个 `apply` 不执行 —— inject 是**激活门禁**，不是降级开关。用户看到的只是「插件 pending」，没有任何报错。由 [test/settings-seam.test.ts](../../test/settings-seam.test.ts) 的黑名单断言拦下。
- **同理，新版才有的服务不要写进模块级 `inject`**：`configForms` 是接缝换代才有的，写进去会让更早宿主上的整个客户端半体 pending（字典、凭据订阅、探测连发声机会都没有）。它走**嵌套** `ctx.inject(['configForms'], …)`，降级限制在「卡片不注册」这一件事上，而且那次缺席**可观测**（服务那一环的 WARN 正是报它）。
- **密钥绝不写进配置面**：只走 `ctx.remote.credentials`。`form.mutate` 写下的每一个字段都落在**活动 profile 的 Cordis patch**，那是明文可读的；卡片因此只让引用名与开关走它。
- 样式只用 `--dsw-alias-*` 语义令牌（见 DSH `docs/web-styling.md`），不写字面色值、不引外部 UI 库；**没有** `--dsw-color-*` 系列，写了不会报错但不会生效。
- **错误色用 `--dsw-alias-state-error-primary`**：官方表单 CSS 写的 `--dsw-alias-label-error` 在 `ui-theme` 里**从未定义**（实测 0 处），照抄原生会静默不着色 —— 抄官方 CSS 时要顺带核令牌是否存在。（**引用官方样式表要写对版本**：旧那份 `ui-settings-plugins/PluginConfigForm.module.css` 在接缝换代后已不存在，等价物在 `ui-primitives/src/settings-form/`。）
- 注册必须走 `ctx.slots.inject(name, () => ctx.slots.register(...))`，禁止模块级副作用。
- 能力探测只**新增提示路径**：槽名 / key / 注册时机一字不改，不查版本号，不因探测失败改动任何既有功能；提示英文、WARN 前缀、落客户端控制台，**迟到必须撤销**（补一条 INFO）。改它要跑产物测试的「配置能力探测」一组。
  **它盯的是「卡片拿不到 `form`」这一个真实故障**，而这条链有**两环**，各自会独立地断、表现都是静默，所以**两环各给一个超时窗口**（服务 `configForms`、槽 `plugins.bundle.config`），各报实际断掉的那一环、各撤各的提示；服务缺席时槽那一环**不发声**（那时「槽在不在」还没到判的时候，报它是替另一环说话）。
  **探测不能只盯槽名**：`plugins.bundle.config` 在接缝换代前后的两版宿主上**都不传 `form`**（座位始终只有 `view`），所以「槽在不在」与「拿不拿得到表单」**结构性地**无关 —— 只换槽名的探测必然说谎。真正会断的那一环是**服务缺席**。
- 改完必须重新 build；产物格式由 [../../scripts/build-client.mjs](../../scripts/build-client.mjs) 负责，不得手改 `lib/client.js`。
- **改渲染面（文案值 / JSX / 样式对象 / 可见状态）必须同批重截卡片图**，中英两张一起；截图占用维护者的浏览器，**先问再动** → [assets/AGENTS.md](../../assets/AGENTS.md)。
