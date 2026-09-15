## Postmortem: v1.6.0/v1.6.1 工具与迁徙同时断在凭据服务上（2026-09-15）

- 摘要：装 1.6.1 后设置卡片正常，但三个知乎工具一律报「没有 key」，旧明文也没搬进凭据存储。两个症状同源：`ctx.get('credentials')` 在本插件的挂载位置上拿不到凭据服务。
- 时间线：23:20 发 v1.6.0 → 修掉客户端半体的 inject 回归后发 v1.6.1（23:39）→ 维护者安装并重启（23:46:25 装入、23:46:58 与 23:55:03 两次重启）→ 卡片正常、工具无 key、`settings.yaml` 明文未动、`.credentials.yaml` 里没有该引用、宿主终端**没有任何 `[zhihu-search]` 行**。
- 根因：取值链塌成 凭据域 → 进程环境 之后，凭据服务的取法成了单点，而那一处用的是 `ctx.get('credentials')`。同一上下文里 `ctx.tools`（module 级 `inject` + 属性访问）一直正常 —— 这个对比就是判据：`ctx.get` 才是失效的那一步。它按 cordis 文档是「不受 inject 约束的读取」，绕过的是门禁而不是服务发现本身。旧版有一条 `fromSettings` 兜底正好替它兜着，所以这个洞在 1.5.2 及以前从未暴露；「删兜底」与「删设置字面量读取」两件事一起，把工具打成了「没有 key」。
- **未定性**：本机三种拓扑（credentials 先挂 / 真实凭据文件 / 服务住在 bundle fiber 下）都复现不出 `ctx.get` 失败，只有「credentials 未就绪」那一种签名吻合。因此修复按**平台保证的路径**做（与 `tools` 同款、与官方 `dsh-webhook-github` 同款），而不是按已定位的机制做 —— 这一点如实记下，别当成已定位。
- **诊断盲区**：本次每一处失败都会 `warn`（`ctx.logger.warn`），但终端里一条都没有。要么 `prepareCredentials` 从未执行（可卡片正常说明同一回调跑了），要么告警没有落到终端。**在查明之前，「日志里没有」不能当作「没发生」**；判断只能看文件状态与工具报错。
- 防再犯：取凭据改为 `ctx.inject(['credentials'], …)` + 属性访问；迁徙嵌在 settings 的 inject 内部再等 credentials，**顺序因此是确定的而不是靠时序**；红线测试静态拦下 `ctx.get('credentials')`；`plugin.test.ts` 的服务替身补上属性面（只填服务表就测不到注入路径）。
- 关联：[密钥存储决策记录](../../.agents/notes/2026-09-15-credential-store-migration.md) · [客户端 inject 复盘](2026-09-15-client-inject-remote-missing.md)（同一类「旁路 vs 正路」） · [架构说明「密钥解析契约」](../ARCHITECTURE.md)
