# dsh-zhihu-search 发布说明

发布前必读。不变的设计约束归 [ARCHITECTURE.md](ARCHITECTURE.md)，日常命令与验证快照归 [AGENTS.md](../AGENTS.md)。

## 发布前检查

1. 工作区干净：`git status` 无未提交改动。
2. 版本号已按下方[版本号](#版本号)的判据定档。
3. `npm run typecheck && npm test` 全绿。
4. `README.md` 与 `README_en.md` 的安装与配置说明与当前行为一致（两份必同改，见 [AGENTS.md](../AGENTS.md) 的全局规则）。
5. `cordis.patch.yml` 里**不含**任何凭据。

## 版本号

按 SemVer 定档，发布时严格对应。定不准时往高一级靠。

| 档位 | 判据 | 本项目实例 |
|---|---|---|
| **major** | 不兼容的破坏性变更 | 工具名 / 参数名 / 输出 schema **收紧**；配置项移除或重命名；peerDependencies 大版本升级 |
| **minor** | 向后兼容的功能新增 | 新工具；新参数；新配置项；UI 新能力 |
| **patch** | 向后兼容的修复 | bug 修复；文档修正；依赖小版本更新；性能优化 |

四条边界：

- 改工具**描述**不改契约，按性质归：修掉一句虚假陈述是 patch，新增参数或错误路径才是 minor。
- 输出 schema 的**放宽**不算破坏：字段变可选、允许省略值，按行为性质归 patch 或 minor；**收紧**才是 major（改名字、换类型、删字段、可选变必填）。
- 只动不随包发布的文件（测试、CI、决策记录）不构成发布理由，搭下次发布的车即可。
- 源码注释随 `lib/types.d.ts` 一起发布，属于产品面：改它是 patch，不是「不用发」。

## 打包内容

发布内容由 [package.json](../package.json) 的 `files` 决定，**以它为准，本文不复制清单** —— 复制的清单会漂移，已经漏过一次 `README_en.md`。

三处需要解释，其余自明：

- `lib/**/*.map` 被排除：这些 source map 指向未随包的 `src/`，对使用者是悬空的，却占了三分之一体积。tsconfig 仍生成它们，本地调试照常。
- `README_en.md` 必须随包：`README.md` 顶部链接指向它，不随包就是 npm 页面上的死链。
- `scripts/` 与 `src/` 不发布，因此 `npm run build` 必须在打包前跑过，`lib/` 是唯一交付物。

校验：

```bash
npm run build
npm pack --dry-run
```

## 构建链的两个事实

- 浏览器半体由 [scripts/build-client.mjs](../scripts/build-client.mjs) 用 esbuild 打成 DSH 的 lazy-CJS 工厂信封。
  官方生成该信封的预设 `clientBundle` 位于 DSH 仓库内 `packages/client/tsdown.client.ts`，**未发布到 npm**，
  所以本包自行复现 —— DSH 升级时需要回归 `test/client-bundle.test.ts`。
- 浏览器半体只允许值导入 `PLATFORM_MODULES` 里列出的模块（DSH `packages/client/web/src/platform.ts`）。
  超出该清单必须同时声明 `dsh.client.inject` 与 `dsh.client.external`。

## 发布到 npm

### 主路径：CI 发布（推荐）

推一个与 `package.json` 版本一致的 tag 即可：[release.yml](../.github/workflows/release.yml) 会跑 `npm ci` → typecheck → test → 校验 tag 与版本一致 → `npm publish --provenance`。

```bash
git tag vX.Y.Z          # X.Y.Z 必须与 package.json 的 version 逐字一致
git push origin vX.Y.Z
```

需要一次性配置：仓库 secret `NPM_TOKEN`，值必须是**启用了 bypass 2FA 的 Granular Access Token**。

### 备选：本地发布

```bash
npm run build
npm pack --dry-run
npm publish --registry=https://registry.npmjs.org/ --access public
```

账号启用 2FA 而令牌没有 bypass 权限时，本地发布会以 `403` 被拒；此时改用 CI 路径，或加 `--otp=<码>` 人工提供一次性口令。

### 前置条件

- `package.json` 的 `repository.url` 必须指向真实仓库，否则 npm 拒绝 provenance 或页面上没有源链接。
- 所有 `@deepseek-ai/*` 保持在 `peerDependencies` 与 `devDependencies`，**不得**进 `dependencies` —— 见 [ARCHITECTURE.md](ARCHITECTURE.md) 的「不可破坏的约束」。
- `package-lock.json` 的 `resolved` 必须指向 `registry.npmjs.org`。锁文件若由国内镜像生成，CI 会去镜像取包（供应链隐患），且 `npm ci` 可能因 peer 未同步而失败。

## CI

- [ci.yml](../.github/workflows/ci.yml)：推 `main` 与每个 PR 跑 typecheck + test。
- [release.yml](../.github/workflows/release.yml)：推 `v*` tag 发布。

两者都用 `npm ci`：它严格按锁文件安装，锁文件与 `package.json` 不同步时直接失败 —— 这是我们要在 CI 里拦下的情况。

## 兼容性

- 宿主版本以 [package.json](../package.json) 的 `peerDependencies` 为准。依赖的是 DSH 的**运行时行为**：`settings.installSection`、`role('secret')` 脱敏、
  `settings.plugin.item` 的分派规则、客户端模块格式。任一处改动都可能在升级后静默失效（卡片不显示或密钥读不到）。
- 判断依据始终以 DSH 源码为准，不凭文档推断。
- 已知缺口见 [AGENTS.md](../AGENTS.md) 的待办。
