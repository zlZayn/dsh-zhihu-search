# client/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

本目录特有约束：

- 禁止运行时 import 其他插件的值：跨插件只走 Cordis 服务，DSH 的 bundle-purity gate 会拒绝值导入。
- 只允许 `import type`（DSH 类型）与**外壳预置模块**的值导入。预置清单以 DSH `packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES` 为准 —— 由 seed 表解析，不需要依赖边。**不要在此抄一份**：原抄件漏了 `react-dom/client` 且混用简写，已删。
- 落在 `PLATFORM_MODULES` 之外的值导入必须同时写进 `dsh.client.inject` 与 `dsh.client.external`，否则工厂不会先到 → [docs/PUBLISHING.md](../../docs/PUBLISHING.md) 的「构建链的两个事实」。
- 只为一个类型引入新的 `peerDependencies` 不划算：客户端装配包（如 `dsh-api-remotes`）用**结构类型**在本目录就地收窄，写法见 `index.tsx` 的 `ClientRemoteFace`。
- **密钥绝不写进设置段**：只走 `ctx.remote.credentials`。`settingsScope.set` 的每一个字段都落在 `settings.yaml`，那是明文可读的。
- 样式只用 `--dsw-alias-*` 语义令牌（见 DSH `docs/web-styling.md`），不写字面色值、不引外部 UI 库；**没有** `--dsw-color-*` 系列，写了不会报错但不会生效。
- 注册必须走 `ctx.slots.inject(name, () => ctx.slots.register(...))`，禁止模块级副作用。
- 改完必须重新 build；产物格式由 [../../scripts/build-client.mjs](../../scripts/build-client.mjs) 负责，不得手改 `lib/client.js`。
