# 决策：卡片文案进 DSH locale 字典，不硬编码（2026-09-12）

已实施，随 v1.2.0 发布。

## 问题

卡片原本把中文写死在组件里。DSH 的 Web 界面支持中英切换，官方还用 `verify-client-ui-i18n` 把「产品客户端文案必须进类型化字典」固化成检查（DSH `packages/client/locale/README.md`）。硬编码的卡片在英文界面下是异类，也接不进 locale 系统。

## 决策

1. 字典独立成 [src/client/locales.ts](../../src/client/locales.ts)，命名空间 `zhihu-search`，中英各一份。
2. 命名空间合并进 `LocaleNamespaceMap`：key 拼错、或只给一种语言，都是**编译错误**，不靠自觉。
3. `apply` 里用 `ctx.effect` 注册字典——`register` 返回 disposer，插件卸载即注销。
4. 槽位注册声明 `locale: 'zhihu-search'`，框架据此把类型化的 `t` 座位注入组件 props。
5. `inject` 增加 `'locale'`。

## 替代方案

- **继续硬编码中文**：零改动，但英文界面下是异类，且与官方 `verify-client-ui-i18n` 的取向相反。
- **自己造语言开关**：重复 locale 服务已有的浏览器探测、持久化与回退链，还会与 DSH 的语言选择器不同步。
- **只在 apply 期 `ctx.locale.bind(ns)` 取 `t` 再传进组件**：可行，但 apply 期取的 `t` 不随语言切换更新；走 `locale:` 座位才能让已挂载的出口自动重取。
- **不合并 `LocaleNamespaceMap`、命名空间用 `string`**：编得过，但丢掉 key 的类型约束与「两种语言必须齐全」的编译期保证。

## 影响

- **硬依赖**：声明 `locale:` 的条目渲染时要求已安装的 locale 面，缺席即报错而不是降级。标准 `dsh web` 装配必然带它，已记进 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「两半体约束」。
- 新增 peer + dev 依赖 `@deepseek-ai/dsh-client-locale`；只用它的类型增强，无值导入，产物 `require` 列表不变（`test/client-bundle.test.ts` 守着）。
- 加文案从「改组件」变成「改一处字典」，且必然两种语言一起改。
