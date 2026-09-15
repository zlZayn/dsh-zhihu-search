## Postmortem: v1.6.0 客户端半体整块装不上（2026-09-15）

- 摘要：装 1.6.0 后设置里的「知乎搜索」卡片不显示，控制台报 `cannot get property "remote" without inject`。host 半体不受影响（工具照常、明文迁徙照常跑），坏的只有卡片。
- 时间线：15:20 发布 v1.6.0（run 34987694534 全绿）→ 维护者自行装入 profile 并重启 host → 卡片加载失败并给出上述报错 → 定位到 `src/client/index.tsx` 的 `export const inject`。
- 根因：`inject` 里只写了点号键 `remote.credentials`，而代码用的是 `ctx.remote` **属性访问**。Cordis 的判据是「服务名**逐字**出现在某个 fiber 的 `inject` 里」（`cordis/lib/index.js:686`），点号键**不会**展开成父级 —— 于是门禁判定未声明，整块 `apply` 抛错。官方 `dsh-client-ui-settings-plugins` 的 `inject` 里 `"remote"` 与 `"remote.credentials"` 两个都写，本插件漏了前者。**这与 2026-09-14 那份复盘是同一类根因**（那次是 agent scope 上的 `ctx.tools`），换了半个体和换了个服务名就重踩了一次。
- 为什么测试全绿：`test/client-bundle.test.ts` 传给 `apply` 的是**普通对象**，Cordis 的属性代理根本没参与，这类 bug 在该层结构性地不可见。更隐蔽的是，即便换成真实 Context，把服务 `provide` 在**根**（祖先）上时查找会在 `fiber.store` 命中直接返回、绕过 inject 门禁 —— 第一版补测就因此假绿，必须让提供者与消费者分属**兄弟分支**才复现得出。
- 防再犯：`test/client-bundle.test.ts` 新增「按真实 Cordis 语义装配」组 —— 真实 Context、兄弟 fiber 拓扑、注入声明取**产物自己导出的** `inject`，配三条反向控制（各少提供一个服务时 `apply` 不得跑）。删除任一依赖即变红。机制写进 [src/client/AGENTS.md](../../src/client/AGENTS.md)，根 [AGENTS.md](../../AGENTS.md) 活跃坑按机制（而非按服务名）记一条。
- 关联：[上一条同类复盘](2026-09-14-hidden-tool-restriction-noop.md) · [决策记录](../../.agents/notes/2026-09-15-credential-store-migration.md) · [架构说明「两半体约束」](../ARCHITECTURE.md)
