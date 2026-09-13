# tools/ — 工具定义层

- 职责：把知乎能力包装为 DSH 工具，产出 Canonical Output。

## 文件索引

- `deps.ts`：各工具共用的依赖包与缓存键计算。
- `search.ts`：`zhihu_search` 站内搜索。不接受站点过滤。
- `global-search.ts`：`zhihu_global_search` 全网搜索，本地拒绝知乎域名。
- `zhida.ts`：`zhihu_zhida` 知乎直答。走 SSE，语义化档位映射为真实模型 id。

## 契约要点

- 每个工具的 `execute` **绝不 throw**：失败一律转为 `{ok:false, error}` → 见架构文档「错误契约」。
- 两个搜索工具的 `output.schema` 必须完全一致，由 `test/tool.test.ts` 守护。
- 缓存只写成功结果，失败结果不入缓存 → 理由见架构文档「缓存与限流」。
- 上游没报的字段不得编造：`contentType` 缺失时留空串，`voteUpCount` 缺失时**整个键省略**（0 与「不知道」是两回事）。

## 变更影响路由

- 增删工具 → 同步 `src/index.ts` 的注册开关、`Config`、根 [README.md](../../README.md) 能力清单、[test/plugin.test.ts](../../test/plugin.test.ts)。
- 改参数集合 → 触发红线 5，跑 [test/redlines.test.ts](../../test/redlines.test.ts)。
- 改 Canonical Output → 契约变更，同步 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 与 [src/README.md](../README.md)。

## 参考

- 参数与输出的不变约定 → 见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「端点契约」
- 工具描述怎么写（三槽结构、不枚举参数取值）→ 见同一文档的「工具描述约定」
- 参数为何不得静默失效 → 见同一文档的「防错清单」
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
