# 决策：用 tools.restrict() 隐藏原生网页工具，并做热切换（2026-09-14）

已实施：新增 `disableNativeWebSearch`（默认 `false`）。打开后模型看不到 DSH 原生的 `web_search` / `web_fetch`，只用知乎的三个工具。

## 问题

插件提供知乎检索，而 DSH 自带的 `web_search` / `web_fetch` 与它职责重叠。用户想「只用知乎」时，需要一个开关把原生工具从模型的视野里摘掉 —— 而不是只在描述里劝阻。

## 决策

- 用 `ctx.tools.restrict({ deny })`，装在**每个 agent 的 scoped ctx** 上（DSH 拒绝全局调用：那会遮蔽每个 agent）。
- 三个时机共用一个幂等对账：`agent/created` 给新 agent 装、`agent/disposed` 销账、设置写入触发的 `onChange` 覆盖 live agent。
- 开关默认 `false`；作用域全域（含子 agent，restriction 沿 scope 链继承）。
- 热切换：可见集在**每次模型请求**时重算，所以拨动后下一次请求即生效，不需要新窗口。
- 装之前先按注册表过滤工具名，并整段 try/catch —— `restrict()` 对未知名字抛错，而 `agent/created` 里的同步异常会否决 agent 创建。

## 替代方案（强制）

- **`ctx.tools.guard()`**：只能拒绝执行，工具仍留在模型上下文里 —— 模型会反复尝试，那不是「隐藏」。
- **让用户自己禁用 tool-web 插件**：把能力开关推给用户装配，插件失去自我表达能力。
- **只在 `agent/created` 装、不做对账**：已运行的会话要等新会话才生效；拨了开关没反应，正是要避免的不优雅。
- **全局 restrict**：DSH 直接拒绝，且语义上会遮蔽每个 agent。
- **只改工具描述做软劝阻**：模型仍可能选错工具，且描述要背起本不属于它的调度职责。

## 影响

- 默认行为不变（`false`），旧用法全部仍然正确 → 按问题链是 **minor**（判例已入库）。
- 插件卸载时显式撤销 restriction：它挂在 agent 的 scope 上，不随本插件卸载自动消失。
- 设计约束记在 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「原生工具的可见性」；踩坑记在根 [AGENTS.md](../../AGENTS.md) 的活跃坑。
- 回归守卫：`test/plugin.test.ts` 的「隐藏原生网页工具」组，其中「tool-web 不在场时不抛错」是 blocker 断言。
