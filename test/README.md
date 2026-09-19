# test/ — 测试对应关系

- 运行：`npm test`（vitest）；类型检查：`npm run typecheck`（覆盖 `src/` 与 `test/`）。
- 夹具在 [helpers.ts](helpers.ts)：走真实 `ZhihuClient`，只替换最外层 `fetch`；导出 `makeHarness` / `jsonResponse` / `sseResponse` / `execContext` / `envelope` 与 `Harness` / `FetchHandler` 类型。

## 覆盖范围

- [sse.test.ts](sse.test.ts)：SSE 分块解析与直答流生命周期。跨字节的多字节字符、`[DONE]` 提前终止、心跳注释、CRLF；中途失败帧终止整轮、响应头之后的取消与超时、流式预算独立于搜索超时。对应 [src/transport.ts](../src/transport.ts)。
- [compiler.test.ts](compiler.test.ts)：参数编译。每条断言对应一条生产实测语法。对应 [src/utils/compiler.ts](../src/utils/compiler.ts)。
- [text.test.ts](text.test.ts)：高亮标签剥离、实体解码、跟踪参数剥离。对应 [src/utils/text.ts](../src/utils/text.ts)。
- [state.test.ts](state.test.ts)：缓存 TTL 与 LRU、令牌桶补充、缓存键隔离。对应 [src/state.ts](../src/state.ts)。
- [credentials.test.ts](credentials.test.ts)：密钥取值链（凭据域 → 进程环境）与空白串处理。对应 [src/credentials.ts](../src/credentials.ts)。
- [migrate.test.ts](migrate.test.ts)：旧明文迁徙的三条纪律。**「先写后删」那条断言的是调用序列而不是终态** —— 反过来中途失败就是密钥永久丢失，这个差别在终态上看不出来。对应 [src/migrate.ts](../src/migrate.ts)。
- [redact-anchor.test.ts](redact-anchor.test.ts)：`Config.accessSecret` 作为 **redact 锚点**的契约。实测：`redactSecrets` 是 schema 驱动的，字段移出 schema 就不再被剥，明文会从 describe 线路走出去。删字段即变红。对应 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「密钥解析契约」。
- [credential-store.test.ts](credential-store.test.ts)：卡片凭据状态源。引用名一换旧答案立即作废、迟到的响应被丢弃、写失败抛出。对应 [src/client/credential-store.ts](../src/client/credential-store.ts)。
- [auth.test.ts](auth.test.ts)：取用顺序、逐请求重取、缺密钥的失败形态。对应 [src/transport.ts](../src/transport.ts)。
- [quota.test.ts](quota.test.ts)：额度自检端点的路径、鉴权头与失败形态。对应 [src/transport.ts](../src/transport.ts)。
- [presentation.test.ts](presentation.test.ts)：呈现层纯度，以及**模型可见文本的四条诚实不变量**（到顶必说 / 来源构成分流 / 空态条件限定 / 到顶与「筛少」互斥）。对应 [src/present/](../src/present/)。
- [tool.test.ts](tool.test.ts)：工具端到端，覆盖投影、参数编译、缓存、错误映射、SSE 拼接，以及**宿主同一套 `output.schema` 校验**（三个工具的成功值与失败值 + 一条反向控制）。对应 [src/tools/](../src/tools/)。
- [plugin.test.ts](plugin.test.ts)：`apply` 装配、设置命名空间注册、配置默认值与 schema 角色、开关裁剪、effect 释放，**旧明文迁徙的接线**（搬进凭据域 / 已有值不覆盖 / 写不进去就不删），以及「隐藏原生网页工具」的对账（**原生工具不在场时不抛错的 blocker 守卫**、热切换、幂等、卸载撤销）。替身只提供免 inject 的 `get('tools')`，并像真实注册表那样对未知名字抛错。对应 [src/index.ts](../src/index.ts)。
- [native-web-tools.test.ts](native-web-tools.test.ts)：同一能力的**实现级**回归 —— 用真实 `dsh-tools` 注册表与真实 `dsh-scope` 链复现 web profile 拓扑（原生工具住在 **preset 的 standing scope** 里），钉住「全局视图看不到它们」「agent scope 上必须走 `get('tools')` 而非属性访问」两条平台事实。
- [client-bundle.test.ts](client-bundle.test.ts)：浏览器半体的**产物契约**（信封 id、导出面、inject 声明、注册进 `plugins.bundle.config` 的 key（等于本包包名）与 `view` 分支，装配时就用默认引用名查一次凭据域，以及**配置槽能力探测**的三条：槽按时到达不发声 / 槽缺席时恰一条英文 WARN / 槽迟到时补一条 INFO 撤销），外加**按真实 Cordis 语义装配**的一组 —— 真实 `Context`、服务由**兄弟** fiber 提供、注入声明取产物自己导出的 `inject`，配三条反向控制。这一组是唯一能看见 inject 门禁的地方：普通替身传的是普通对象，Cordis 的属性代理根本没参与（v1.6.0 卡片加载失败正是这样漏出去的 → [复盘](../docs/postmortem/2026-09-15-client-inject-remote-missing.md)）。
- [dist.test.ts](dist.test.ts)：host 半体**编译产物图**的两条不变量 —— `lib/` 里的 host 图能在 Node 中求值、浏览器信封不与 host 传输层抢同一路径（[事故复盘](../docs/postmortem/2026-09-12-client-js-path-collision.md)）。
- [contract-helpers.ts](contract-helpers.ts)：契约测试的**共享底座**（直连客户端的 `callApi` + 指纹纯函数），刻意不 import `src/`。
- [contract-helpers.test.ts](contract-helpers.test.ts)：该底座的**离线**自检（指纹工具写错会让契约测试假绿）。常驻日常 CI。
- [contract-live-search.test.ts](contract-live-search.test.ts) / [contract-live-global-search.test.ts](contract-live-global-search.test.ts)：**契约测试**，直连真实知乎接口盯上游行为指纹。**不在日常 CI 里**，见下方「契约测试」一节。
- [redlines.test.ts](redlines.test.ts)：五条红线的可执行守卫（依赖分层 / 呈现隔离 / 模型上下文隔离 / 无全局状态 / 模型不见原始语法），含 `package.json` 依赖检查与源码静态检查；另有一条**取服务路径**守卫 —— `src/index.ts` 的生效代码行里不得出现 `ctx.get('credentials')`（理由见 [复盘](../docs/postmortem/2026-09-15-credential-service-unreachable.md)）；还有一组 `文档不抄实测值` —— 活文档与 workflow 里不得留会漂的宿主版本字面量，门面双件只有在**同一行写出真源 [package.json](../package.json)** 时才允许留（记录层 `.agents/notes/`、`docs/postmortem/` 除外，它们写的是当时的事实）；以及一组 `锁文件` —— `package-lock.json` 的 `resolved` 必须指向官方源（此前这条只写在 [发布手册](../docs/PUBLISHING.md) 的前置条件里）。

产物级测试是**两个**（client-bundle 与 dist），它们读 `lib/`，故 `npm test` 先跑 build；其余测试一律从 `src/` 导入。

## 契约测试（API 防腐化）

盯的是**上游行为**，不是我们的实现：知乎是黑盒，已经实测出来的结论（区间只筛候选、host 精确匹配、未记载的 `Filter` 可用……）会随上游悄悄漂移，所以把它们写成会红的断言。

- 跑法：`npm run test:contract`（需 `ZHIHU_ACCESS_SECRET`）；CI 由 [.github/workflows/contract.yml](../.github/workflows/contract.yml) 每周一 UTC 01:00 + 手动触发。
- **不进日常 CI**：花真实配额（每轮二十余次调用），且契约漂移是「周」级信号。日常 `npm test` 由 [vitest.config.ts](../vitest.config.ts) 排除 `test/contract-live-*.test.ts`；契约跑法由 [vitest.contract.config.ts](../vitest.contract.config.ts) 定义（串行 + 30s 超时）；底座的离线自检留在日常套件里。
- **不 import `src/`**：只用 `fetch` 直连上游，避免插件的解析 bug 同时污染被测对象与断言。
- 密钥缺席时**红**，不静默跳过。
- **红了怎么办（顺序不可颠倒）**：① 重跑确认不是偶发 → ② 重跑探针确认上游变成了什么 → ③ 更新 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「端点契约 / 防错清单 / 与知乎官方文档的偏差」 → ④ 最后才改实现与断言。

## 版本敏感面（宿主升级时先看这里）

各层对 DSH 版本的敏感度差别很大 —— 这决定了 [compat.yml](../.github/workflows/compat.yml) 红了之后该往哪看：

- **不敏感**：L1 纯逻辑与 L2 产物契约（走真实 `ZhihuClient`、只换最外层 `fetch`），以及用最小替身装配的 [plugin.test.ts](plugin.test.ts)。它们对宿主版本无感，红了先怀疑**换包装错了**，不是上游变了。
- **敏感（L3b / L6a）**：用**真实** DSH 包跑装配的三处 ——
  - [native-web-tools.test.ts](native-web-tools.test.ts)：真实 `dsh-tools` + `dsh-scope` + `dsh-system-prompt` + cordis，复现 web profile 拓扑；
  - [client-bundle.test.ts](client-bundle.test.ts)：按真实 Cordis 语义装配客户端入口，是唯一能看见 inject 门禁的地方；
  - [dist.test.ts](dist.test.ts)：编译后的 host 图能否在 Node 中求值（吃 `dsh-tools` 的导出面）。
  这三处红了 = **平台语义变了**，是最该警惕的一类。
- **类型面**：`npm run typecheck` 覆盖 `src/` 与 `test/`。宿主收紧 API 签名时**它先红，而全部测试仍然全绿** —— 所以「测试全绿」不能当作「兼容」的结论。

宿主的换包实测由 [compat.yml](../.github/workflows/compat.yml) 每周跑一次（`next` 承诺线 / `alpha` 前瞻线），跑的就是上面这些现有用例，不额外写测试；机制与处理链见 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「兼容性」。

## 测试约定

- 时间相关断言注入 `now`，不依赖真实时钟。
- 验限流必须**换问题**：同一问题同一档位会命中插件缓存（毫秒返回），根本打不到平台 —— 实测第一次验收就是这样假通过的。
- 真机验收用 [scripts/acceptance.mjs](../scripts/acceptance.mjs)：它直接 import 装好的产物，同时覆盖真实接口、宿主 `output.schema` 校验与模型可见文本。这三件事单元测试都够不到（v1.4.0 的 P0 正是漏在这条缝里）。
- 断言「失败不入缓存」使用不被重试的错误码；`90001` 会被客户端自动重试，第一次调用实际成功。
- 校验 `cordis.patch.yml` 前先滤掉注释行：注释会正当地提到被否决的写法。
- `@deepseek-ai/*` 在 npm 的 `latest` 标签是过期版本（具体值现查 `npm view @deepseek-ai/dsh dist-tags`）；安装版本以 [package.json](../package.json) 的 `peerDependencies` 为准，当前该跟哪条线由 [compat.yml](../.github/workflows/compat.yml) 盯。
- 产物契约测试里外壳预置模块要替身：`ui-primitives` 是浏览器静态库，Node 中导入会因缺 `clsx` 失败；浏览器里它由 `PLATFORM_MODULES` seed 表提供。

## 参考

- 本目录的使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
- 维护规则与验证快照 → 见 [../AGENTS.md](../AGENTS.md)
- 被测模块的职责 → 见 [src/README.md](../src/README.md)
