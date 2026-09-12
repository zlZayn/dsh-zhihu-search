## Postmortem: 浏览器半体产物覆盖 host 模块导致 DSH 启动崩溃（2026-09-12）

- 摘要：`npm run build` 的 esbuild 步骤把 `lib/client.js` 覆盖成浏览器信封，而该路径本是 host 传输层 `src/client.ts` 的编译产物。`lib/utils/errors.js` 的 `import { ZhihuClientError } from '../client.js'` 因此拿到信封，DSH 启动即 `SyntaxError: does not provide an export named 'ZhihuClientError'`。142 条测试当时全绿。
- 时间线：2026-09-12 客户端半体接入（新增 `scripts/build-client.mjs`，`outfile: 'lib/client.js'`）→ 首次 build 覆盖生效 → 重启 `dsh web` 崩溃 → 手动清理 `cordis.patch.yml` 恢复。
- 根因：`tsc`（`rootDir: src` → `outDir: lib`）与 esbuild 的 `outfile` 指向同一路径，且**没有任何机制**让后跑的步骤发现它覆盖了前者的产物。
- 防再犯：host 模块改名 `src/client.ts` → `src/transport.ts`，`lib/client.js` 专供浏览器半体；`scripts/build-client.mjs` 启动时若发现 `src/client.ts(x)` 存在则直接报错；新增 `test/dist.test.ts` 只加载 `lib/` 编译产物，补齐「测试从不跑编译图」的盲区。
- 关联：[决策记录](../../.agents/notes/2026-09-12-client-half-settings-card.md) · [架构说明](../ARCHITECTURE.md)
