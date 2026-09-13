# 决策：额度不做进设置卡片，`quota()` 只做自检（2026-09-13）

已否决，不实施。

## 问题

`ZhihuClient.quota()` 已经实现（[src/transport.ts](../../src/transport.ts)，注释写明「实测不消耗业务额度，可用于自检」），但零调用、零覆盖。诉求是把它显示在设置卡片里，让用户看到「今日额度」。

## 决策

不做。保留 `quota()` 作为公开自检能力，并补上它此前缺失的测试覆盖（[test/quota.test.ts](../../test/quota.test.ts)）。

## 替代方案

- **走 Remote API 把额度送进卡片**：这是官方机制（DSH `docs/cookbook/adding-a-remote-api.zh.md`），技术上可行，但代价与一个只读数字不成比例。
  - `@Remote` 必须落在一个 Loader entry 插件包里，客户端贡献由 `@deepseek-ai/dsh-api-remotes` 的 assembly 挂载——那是 DSH 单体仓库内的**静态装配**（其 README：「imports generated `/remote` artifacts as runtime values, mounts each contribution through `ctx.remote.$mount()`」），不是动态发现。
  - 还要新增 peer 依赖 `@deepseek-ai/dsh-typert-protocol`、`./typert` 与 `./remote` 两个生成入口、装饰器配置，以及一个由单体仓库 `build:lib` 驱动的 codegen 步骤。
  - 收益是卡片上一个只读数字；代价是一条容易随 DSH 升级失效的新构建链。
- **加一个额度查询工具**：被明令排除（插件定位是搜索），且会把诊断能力暴露给模型。
- **把额度写进设置命名空间**：设置是用户配置，塞运行时会污染语义并让 schema 说谎。
- **启动时把额度写日志**：零依赖，但引入一条每次启动都发的网络请求，且用户要翻日志才看得到。

## 影响

- 额度目前只能由导入 `ZhihuClient` 的调用方自检；卡片不显示。
- 若将来 DSH 给出第三方可用的 Remote 装配入口，本决策应重评。
