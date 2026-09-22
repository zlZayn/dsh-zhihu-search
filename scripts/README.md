# scripts/ — 构建与校验脚本

- 职责：构建可发布产物，并校验产物本身、发版资格与宿主兼容性。本目录脚本都不进入运行时。

## 文件索引

- `build-client.mjs`：用 esbuild 生成浏览器半体的 lazy-CJS 工厂信封（`window.__ModuleLoader__.load({ id, factory })`），被 `npm run build` 调用，产物为 `lib/client.js`。
  信封为何必须长这样、官方预设为何不能直接用 → 见 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「构建链的两个事实」，此处不重述。
- `release-guard.mjs`：**发版守卫**。从 stdin 读「上个 tag..HEAD」的改动清单，判定这段区间是否真的改变了已发布产物；只剩非产物改动时以非零退出码拦下发布。

`check-release.mjs`：**发布态守卫**。断言五条发布态不变量（`dsh.bundle.patch` 在、`private` 未设、`engines.dsh` 已声明、`files` 含 `cordis.patch.yml`、LICENSE 在），被 `npm run check:release` 调用、[release.yml](../.github/workflows/release.yml) 发布前跑。
  口径是「能否改变 npm 上的产物」而非「文件是否随包发布」：`build-client.mjs` 自己不随包，却决定 `lib/client.js` 长什么样，所以算产物改动。接线在 [release.yml](../.github/workflows/release.yml)，判定规则归 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的 Q0。
- `acceptance.mjs`：**验收脚本**。对指定包目录的产物打真实接口，验三件事：下限扩池、输出面与排序档位对称、`site` 归一化；每条都过一遍宿主的 `output.schema` 校验器，并打印模型可见文本。
  用法 `ZHIHU_ACCESS_SECRET=xxx node scripts/acceptance.mjs [包目录]`，默认验本机 profile 里装的那份；退出码非 0 即有未通过项。
  为什么它必须存在：单元测试读的是 `execute()` 的返回值，既不过宿主那道校验，也拿不到渲染文本 —— v1.4.0 的 P0 正是漏在这条缝里（[复盘](../docs/postmortem/2026-09-14-output-schema-drift.md)）。
- `compat-swap.mjs`：**兼容性换包**。把 DSH 依赖的**声明区间**就地换成某条 dist-tag 线上的精确版本，交给 [compat.yml](../.github/workflows/compat.yml) 去跑现有测试。
  三个子命令：`check <tag>`（只读，判声明面还罩不罩得住那条线）、`swap <tag>`（改写 `package.json`）、`verify <tag>`（断言实装版本就是 tag 上的版本）。
  写回是**保形**的：只换区间里的下限版本，比较符与上界原样留下（形如 `>=… <下一个大版本>` 的声明换到别的版本后仍是同一个上界）
  —— 硬编码 `'^' + version` 会让声明面在 CI 里悄悄变形，而人只看到 job 绿。
  为什么是「改写 package.json + 裸 `npm install`」而不是 `npm install <包>@<tag>`、以及 `verify` 为什么必须有 —— 见脚本头部注释，那里写的是实测结论而不是推断。

## 变更影响路由

- 改信封格式或 external 清单 → 跑 `test/client-bundle.test.ts`（只请求平台模块）与 `test/dist.test.ts`（编译图可求值）。
- 改产物路径 → 必须同时确认不与 `tsc` 输出撞车，并同步根 [package.json](../package.json) 的 `exports['./client']`。
- 改构建脚本 → 同步 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「构建链的两个事实」。
- 改验收脚本 → 在真机 profile 上实跑一次（默认目标就是它），确认结论可复现；它不进 CI（花真实配额）。
- 改守卫的判定口径 → 同步 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的 Q0 与判例库；改完用「纯文档区间」和「含源码区间」各喂一次 stdin，确认两个方向都对。
- 改换包脚本的参与范围或判据 → 同步 [compat.yml](../.github/workflows/compat.yml) 的注释与 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「兼容性」节；`check` 与 `swap` 的参赛集合必须保持一致，否则声明面会出现脚本看不见的缺口。

## 参考

- 产物为何必须是这个格式 → 见 [docs/PUBLISHING.md](../docs/PUBLISHING.md)
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
