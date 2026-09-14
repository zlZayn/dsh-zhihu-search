# scripts/ — 构建脚本

- 职责：把源码打成可发布的产物。只服务构建，不参与运行时。

## 文件索引

- `build-client.mjs`：用 esbuild 生成浏览器半体的 lazy-CJS 工厂信封（`window.__ModuleLoader__.load({ id, factory })`），被 `npm run build` 调用，产物为 `lib/client.js`。
  信封为何必须长这样、官方预设为何不能直接用 → 见 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「构建链的两个事实」，此处不重述。
- `acceptance.mjs`：**验收脚本**（不是构建脚本）。对指定包目录的产物打真实接口，验三件事：下限扩池、输出面与排序档位对称、`site` 归一化；每条都过一遍宿主的 `output.schema` 校验器，并打印模型可见文本。
  用法 `ZHIHU_ACCESS_SECRET=xxx node scripts/acceptance.mjs [包目录]`，默认验本机 profile 里装的那份；退出码非 0 即有未通过项。
  为什么它必须存在：单元测试读的是 `execute()` 的返回值，既不过宿主那道校验，也拿不到渲染文本 —— v1.4.0 的 P0 正是漏在这条缝里（[复盘](../docs/postmortem/2026-09-14-output-schema-drift.md)）。

## 变更影响路由

- 改信封格式或 external 清单 → 跑 `test/client-bundle.test.ts`（只请求平台模块）与 `test/dist.test.ts`（编译图可求值）。
- 改产物路径 → 必须同时确认不与 `tsc` 输出撞车，并同步根 [package.json](../package.json) 的 `exports['./client']`。
- 改构建脚本 → 同步 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「构建链的两个事实」。
- 改验收脚本 → 在真机 profile 上实跑一次（默认目标就是它），确认结论可复现；它不进 CI（花真实配额）。

## 参考

- 产物为何必须是这个格式 → 见 [docs/PUBLISHING.md](../docs/PUBLISHING.md)
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
