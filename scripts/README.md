# scripts/ — 构建脚本

- 职责：把源码打成可发布的产物。只服务构建，不参与运行时。

## 文件索引

- `build-client.mjs`：用 esbuild 生成浏览器半体的 lazy-CJS 工厂信封（`window.__ModuleLoader__.load({ id, factory })`），被 `npm run build` 调用，产物为 `lib/client.js`。
  信封为何必须长这样、官方预设为何不能直接用 → 见 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「构建链的两个事实」，此处不重述。

## 变更影响路由

- 改信封格式或 external 清单 → 跑 `test/client-bundle.test.ts`（只请求平台模块）与 `test/dist.test.ts`（编译图可求值）。
- 改产物路径 → 必须同时确认不与 `tsc` 输出撞车，并同步根 [package.json](../package.json) 的 `exports['./client']`。
- 改本目录任一文件 → 同步 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「构建链的两个事实」。

## 参考

- 产物为何必须是这个格式 → 见 [docs/PUBLISHING.md](../docs/PUBLISHING.md)
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
