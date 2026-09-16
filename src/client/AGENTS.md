# client/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

本目录特有约束：

- 禁止运行时 import 其他插件的值：跨插件只走 Cordis 服务，DSH 的 bundle-purity gate 会拒绝值导入。
- 只允许 `import type`（DSH 类型）与**外壳预置模块**的值导入。预置清单以 DSH `packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES` 为准 —— 由 seed 表解析，不需要依赖边。**不要在此抄一份**：原抄件漏了 `react-dom/client` 且混用简写，已删。
- 落在 `PLATFORM_MODULES` 之外的值导入必须同时写进 `dsh.client.inject` 与 `dsh.client.external`，否则工厂不会先到 → [docs/PUBLISHING.md](../../docs/PUBLISHING.md) 的「构建链的两个事实」。
- 只为一个类型引入新的 `peerDependencies` 不划算：客户端装配包（如 `dsh-api-remotes`）用**结构类型**在本目录就地收窄，写法见 `index.tsx` 的 `ClientRemoteFace`。
- **`inject` 必须对齐真实的访问方式**：Cordis 的判据是「服务名**逐字**出现在某个 fiber 的 `inject` 里」，点号键**不展开**成父级。走 `ctx.remote.credentials` 属性链就要同时声明 `remote` 与 `remote.credentials` —— 只写后者不是降级，是整块装不上（`cannot get property "remote" without inject`）→ [复盘](../../docs/postmortem/2026-09-15-client-inject-remote-missing.md)。
- 改 `inject` 后必须跑 [产物测试](../../test/client-bundle.test.ts) 的「按真实 Cordis 语义装配」组：它是唯一能看见这道门禁的地方，普通替身（传普通对象当 `ctx`）结构性地看不见。
- **密钥绝不写进设置段**：只走 `ctx.remote.credentials`。`settingsScope.set` 的每一个字段都落在 `settings.yaml`，那是明文可读的。
- 样式只用 `--dsw-alias-*` 语义令牌（见 DSH `docs/web-styling.md`），不写字面色值、不引外部 UI 库；**没有** `--dsw-color-*` 系列，写了不会报错但不会生效。
- 注册必须走 `ctx.slots.inject(name, () => ctx.slots.register(...))`，禁止模块级副作用。
- 改完必须重新 build；产物格式由 [../../scripts/build-client.mjs](../../scripts/build-client.mjs) 负责，不得手改 `lib/client.js`。
- **改渲染面（文案值 / JSX / 样式对象 / 可见状态）必须同批重截卡片图**，中英两张一起；截图占用维护者的浏览器，**先问再动** → [assets/AGENTS.md](../../assets/AGENTS.md)。
