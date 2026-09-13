# src/ — 源码手册

- 职责：插件全部实现。`index.ts` 是唯一接触 Cordis 的模块，其余均可脱离框架单测。

## 文件索引

- `index.ts`：插件入口。导出 `name` / `inject` / `Config` / `apply`，以及常量 `ZHIHU_SETTINGS_NAMESPACE` 与 `DEFAULT_ACCESS_SECRET_REF`；在 `ctx.effect()` 内创建客户端与状态并注册工具。被 DSH loader 加载。
- `transport.ts`：知乎传输层。鉴权、GET/POST、SSE 解析、错误映射、可取消重试。被 `tools/` 依赖。
- `state.ts`：缓存与令牌桶，以及缓存键计算。被 `index.ts` 创建、被 `tools/` 使用。
- `credentials.ts`：Access Secret 的解析优先级（凭据域 → 设置字面量 → 环境变量）。纯函数 + 注入来源，被 `index.ts` 使用。
- `types.ts`：知乎原始响应类型与 Canonical Output 类型。
- `tools/`：工具定义，见 [tools/README.md](tools/README.md)。
- `utils/`：编译器与文本清洗，见 [utils/README.md](utils/README.md)。
- `present/`：纯函数呈现层，见 [present/README.md](present/README.md)。
- `client/`：浏览器半体（设置卡片），见 [client/README.md](client/README.md)。

## 依赖方向

`index.ts` → `tools/` + `state.ts` + `transport.ts`；`tools/` → `utils/` + `present/` + `transport.ts`；`present/` 与 `utils/` 不反向依赖任何模块。

为什么必须单向、哪些模块不认识框架 → 见 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「模块骨架与依赖方向」。

## 变更影响路由

- 改 `transport.ts` 的端点或响应处理 → 同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「请求生命周期」，并跑 `test/sse.test.ts`、`test/tool.test.ts`。
- 改 `utils/compiler.ts` 的语法 → 必须先用生产凭据复核，再改 `test/compiler.test.ts`，并同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「与知乎官方文档的偏差」。
- 改 Canonical Output 字段 → 契约变更，同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「端点契约」、[tools/README.md](tools/README.md) 与两个搜索工具的 schema 一致性测试。
- 改 `utils/errors.ts` 的分类或 `hint` 文案 → `error.kind` 与 `hint` 是对模型的契约，增删取值等于改契约，需同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「错误契约」并跑 `test/tool.test.ts`。
- 改 `state.ts` 的 TTL、令牌桶或缓存键 → 同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「缓存与限流」，跑 `test/state.test.ts`；缓存键必须用归一化参数加凭据来源标识。
- 改呈现层 → 跑 `test/presentation.test.ts` 与 `test/redlines.test.ts`。
- 改密钥解析优先级 → 契约变更，跑 `test/credentials.test.ts` 与 `test/auth.test.ts`，同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「密钥解析契约」；若环境变量名 `ZHIHU_ACCESS_SECRET` 变更，同时改根 [README.md](../README.md) 的那一句。
- 改 `client/` → 必须 `npm run build`（`link:` 直接读 `lib/client.js`），跑 `test/client-bundle.test.ts`，并确认注册 key 与 `ZHIHU_SETTINGS_NAMESPACE` 一致。
- 新增模块或调整依赖方向 → 同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「模块骨架与依赖方向」，并同步本文件的「文件索引」与 [AGENTS.md](AGENTS.md) 的约束。

## 已知限制

- 直答的流式读取没有本地超时：`openChatStream` 返回后即释放定时器，卡死的连接只能靠调用方 `signal` 终止。当前工具一次性消费完整流，暂不受影响；若要支持边流边回传 UI，必须改成「定时器随流结束才释放」。
- `global_search` 的 `SortBy` 被端点忽略（**实测多次**，连非法字段名也照回 `code=0`），故未向该工具暴露排序参数。

## 参考

- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
- 不变的设计约束 → 见 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
