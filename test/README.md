# test/ — 测试对应关系

- 运行：`npm test`（vitest）；类型检查：`npm run typecheck`（覆盖 `src/` 与 `test/`）。
- 夹具在 [helpers.ts](helpers.ts)：走真实 `ZhihuClient`，只替换最外层 `fetch`。

## 覆盖范围

- [sse.test.ts](sse.test.ts)：SSE 分块解析。跨字节的多字节字符、`[DONE]` 提前终止、心跳注释、CRLF。对应 [src/transport.ts](../src/transport.ts)。
- [compiler.test.ts](compiler.test.ts)：参数编译。每条断言对应一条生产实测语法。对应 [src/utils/compiler.ts](../src/utils/compiler.ts)。
- [text.test.ts](text.test.ts)：高亮标签剥离、实体解码、跟踪参数剥离。对应 [src/utils/text.ts](../src/utils/text.ts)。
- [state.test.ts](state.test.ts)：缓存 TTL 与 LRU、令牌桶补充、缓存键隔离。对应 [src/state.ts](../src/state.ts)。
- [credentials.test.ts](credentials.test.ts)：密钥解析优先级与空白串处理。对应 [src/credentials.ts](../src/credentials.ts)。
- [auth.test.ts](auth.test.ts)：字面量与凭据服务的取用顺序、逐请求重取、缺密钥的失败形态。对应 [src/transport.ts](../src/transport.ts)。
- [quota.test.ts](quota.test.ts)：额度自检端点的路径、鉴权头与失败形态。对应 [src/transport.ts](../src/transport.ts)。
- [presentation.test.ts](presentation.test.ts)：呈现层纯度。对应 [src/present/](../src/present/)。
- [tool.test.ts](tool.test.ts)：工具端到端，覆盖投影、参数编译、缓存、错误映射、SSE 拼接。对应 [src/tools/](../src/tools/)。
- [plugin.test.ts](plugin.test.ts)：`apply` 装配、设置命名空间注册、配置默认值与 schema 角色、开关裁剪、effect 释放。对应 [src/index.ts](../src/index.ts)。
- [client-bundle.test.ts](client-bundle.test.ts)：浏览器半体的**产物契约**（信封 id、导出面、注册进 `settings.plugin.item` 的 key）。依赖 `lib/client.js` 已构建，故 `npm test` 先跑 build。
- [redlines.test.ts](redlines.test.ts)：四条红线的可执行守卫，含 `package.json` 依赖检查与源码静态检查。

## 测试约定

- 时间相关断言注入 `now`，不依赖真实时钟。
- 断言「失败不入缓存」使用不被重试的错误码；`90001` 会被客户端自动重试，第一次调用实际成功。
- 校验 `cordis.patch.yml` 前先滤掉注释行：注释会正当地提到被否决的写法。
- `@deepseek-ai/*` 在 npm 的 `latest` 标签是过期版本；安装版本以 [package.json](../package.json) 的 `peerDependencies` 为准。
- 产物契约测试里外壳预置模块要替身：`ui-primitives` 是浏览器静态库，Node 中导入会因缺 `clsx` 失败；浏览器里它由 `PLATFORM_MODULES` seed 表提供。

## 参考

- 维护规则与验证快照 → 见 [../AGENTS.md](../AGENTS.md)
- 被测模块的职责 → 见 [src/README.md](../src/README.md)
