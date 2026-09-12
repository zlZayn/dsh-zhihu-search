# dsh-zhihu-search 发布说明

发布前必读。不变的设计约束归 [ARCHITECTURE.md](ARCHITECTURE.md)，日常命令与验证快照归 [AGENTS.md](../AGENTS.md)。

## 发布前检查

1. 工作区干净：`git status` 无未提交改动。
2. 版本号已按语义更新：补丁 = 修复 / 文档，次要 = 功能或行为，主要 = 破坏性。
3. `npm run typecheck && npm test` 全绿。
4. `README.md` 的安装与配置说明与当前行为一致。
5. `cordis.patch.yml` 里**不含**任何凭据。

## 打包内容

`package.json` 的 `files` 决定发布内容，只有四项：

```
lib/               构建产物（host ESM + 浏览器半体 lib/client.js + 类型声明）
cordis.patch.yml   bundle patch，把插件行插入 profile
README.md
LICENSE
```

校验：

```bash
npm run build
npm pack --dry-run
```

`scripts/` 与 `src/` **不发布** —— 因此 `npm run build` 必须在打包前跑过，`lib/` 是唯一交付物。

## 构建链的两个事实

- 浏览器半体由 [scripts/build-client.mjs](../scripts/build-client.mjs) 用 esbuild 打成 DSH 的 lazy-CJS 工厂信封。
  官方生成该信封的预设 `clientBundle` 位于 DSH 仓库内 `packages/client/tsdown.client.ts`，**未发布到 npm**，
  所以本包自行复现 —— DSH 升级时需要回归 `test/client-bundle.test.ts`。
- 浏览器半体只允许值导入 `PLATFORM_MODULES` 里列出的模块（DSH `packages/client/web/src/platform.ts`）。
  超出该清单必须同时声明 `dsh.client.inject` 与 `dsh.client.external`。

## 发布到 npm

```bash
npm run build
npm pack --dry-run        # 先看内容
npm publish --access public
```

发布前置条件：

- `package.json` 的 `repository.url` 必须指向真实仓库，否则 npm 拒绝 provenance 或页面上没有源链接。
- 所有 `@deepseek-ai/*` 保持在 `peerDependencies` 与 `devDependencies`，**不得**进 `dependencies` —— 见 [ARCHITECTURE.md](ARCHITECTURE.md) 的「不可破坏的约束」。

## 兼容性

- 宿主版本 `0.1.5-rc.2`。依赖的是 DSH 的**运行时行为**：`settings.installSection`、`role('secret')` 脱敏、
  `settings.plugin.item` 的分派规则、客户端模块格式。任一处改动都可能在升级后静默失效（卡片不显示或密钥读不到）。
- 判断依据始终以 DSH 源码为准，不凭文档推断。
- 已知缺口见 [AGENTS.md](../AGENTS.md) 的待办。
