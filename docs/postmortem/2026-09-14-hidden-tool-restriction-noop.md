## Postmortem: v1.3.0「隐藏原生网页工具」开关静默无效（2026-09-14）

- 摘要：开关保存成功、设置里确实是 `true`，但模型照旧看得见并能调用 `web_search` / `web_fetch`；没有任何报错或告警。1.3.0 的这项能力等于没发布。
- 时间线：13:01 装入 1.3.0 → 13:16 拨开关并保存（settings.yaml 落成 `true`）→ 13:2x 用户实测同会话仍可调用 → 13:25 在真实注册表上复现并定位两处根因。
- 根因：两个平台假设叠在一起，又被一个 `catch {}` 一起吞掉。
  1. **工具不在全局层**：web profile 关掉了 base bundle 的全局 `tool-web` 行（DSH `bundle/web-app/cordis.patch.yml:470`），改由 **agent preset 的 standing scope** 注册；而预检查读的是**根上下文的全局视图**，永远得到空集合。
  2. **取用路径错误**：`agent.ctx.tools` 属性访问会抛 `cannot get property "tools" without inject`（agent scope 的依赖面不由本插件决定），必须走免 inject 的 `agent.ctx.get('tools')`。
- 防再犯：新增实现级回归 [test/native-web-tools.test.ts](../../test/native-web-tools.test.ts) —— 用**真实注册表 + 真实 scope 链**复现 preset 拓扑，并断言"属性访问抛错、`get` 可用"；替身（[test/plugin.test.ts](../../test/plugin.test.ts)）改为对未知名字抛错，不再模拟害人的全局视图；`catch` 只吞两种预期失败（无工具服务、名字不在链上）。
- 关联：[决策记录](../../.agents/notes/2026-09-14-hide-native-web-tools.md) · [架构说明「原生工具的可见性」](../ARCHITECTURE.md) · 根 [AGENTS.md](../../AGENTS.md) 活跃坑
