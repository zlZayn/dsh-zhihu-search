# 决策：密钥搬进凭据存储，删掉设置里的字面量通道（2026-09-15）

已实施。

## 问题

`~/.dsh/settings.yaml` 的 `zhihu-search.accessSecret` 是明文。

DSH 本身有凭据存储（`$DSH_HOME/.credentials.yaml`）与引用机制，官方四个同类插件全走它：

| 包 | 字段 | 角色 |
|---|---|---|
| `dsh-web-search-deepseek` | `apiKeyEnv` | `credential-ref` |
| `dsh-llm-deepseek` | `apiKeyEnv` | `credential-ref` |
| `dsh-llm-pi-ai` | `apiKeyEnv` | `credential-ref` |
| `dsh-webhook-github` | `secretEnv` | `credential-ref` |
| **本插件** | **`accessSecret`** | **`secret`** ← 唯一的异类 |

`dsh-credentials` 的包描述就是契约：*settings carry references to secrets, providers own the values*。
所以这不是「把密钥挪个地方」，是**插件比 DSH 多开了一条密钥通道**；删掉那条通道，剩下的自动就是原生形状。

## 决策

- **取值链塌成一条**：凭据域 → 进程环境。`fromSettings` 整条删除，三源优先级作废 —— 三个来源才需要定序。
- **引用名加语法守卫**：卡片上是自由文本框，而 seam 的语法是 POSIX shell 标识符，越界的名字会让 `credentialRef()` 抛错。按 seam 自己的说法读作「未配置」。
- **卡片改走 `ctx.remote.credentials`**：`describe` 出徽标、`set` 写入 `.credentials.yaml`、`writable === false` 时禁用输入框、订阅 `credentials/reference-updated` 刷新。
- **Host 启动时一次性迁徙**：先写凭据域、再删设置里的明文；凭据域已有值时不覆盖；搬不动就原样保留并告警。
- **`Config.accessSecret` 留在 schema 里**，但不再是取值来源（理由见下）。

## 关键实测：redact 是 schema 驱动的

`redactSecrets` 只剥 **schema 里带 `role('secret')`** 的字段。

字段一旦移出 schema，redact 就不再认识它，明文会**原样出现在发往浏览器的 describe 线路里**。
用真实 `dsh-settings-file` 实测确认（2026-09-15）。

这条直接否决了「既然没人读了就彻底删掉」这个最自然的写法 —— 而且它的失败是静默的：
功能测试全绿，泄漏从线路走出去。由 [test/redact-anchor.test.ts](../../test/redact-anchor.test.ts) 固化。

## 替代方案

- **把 `accessSecret` 移出 schema、彻底删除**：实测否决 —— redact 随之失效，明文改走 describe 线路。
- **保留字段但降为最低优先级，不做迁徙**：否决。明文永久留在盘上，「文件被截图/上传就漏」的风险一分没减，等于没解决。
- **卡片上加一个「迁移到凭据存储」按钮**：做不到。redact 在服务端就剥掉了明文，卡片刻意永远收不到它 —— 这正是卡片安全的理由。按下去只能让用户重新粘贴一遍。
- **只告警、让用户自己删**：否决。插件不碰用户文件是好习惯，但代价是风险窗口一直开着，而残留会变成没人读的死配置。
- **给老明文加一条 resolver 兜底**：否决。兜底会让明文通道永远活着，与「删掉这条通道」直接矛盾；搬不动时的正确动作是告警 + 保留，不是继续用它。

## 影响

- 净删代码：`SecretSources.fromSettings`、`credentialId()` 的字面量分支、卡片的 `readConfigured()` 与 `mirror` 参数、`SECRET_FIELD` 与 `scope.set` 写入。
- 新增两个模块，各有明确职责与删除条件：`src/migrate.ts`（等使用者跨过这一版后整份删除）、`src/client/credential-store.ts`。
- 徽标语义变准：过去只认「设置里填过」，手工写 `.credentials.yaml` 或 export 环境变量时工具能用而卡片显示「未配置」；现在问 `describe().configured`，覆盖环境变量这条通道。
- 组合配置（`cordis.patch.yml`）里的明文搬得走但删不掉，只告警 —— 那是用户手写的文件，插件没有也不该有改写它的口子。
- 边界：极简装配没挂 `dsh-credentials-local` 且密钥只在设置里时，迁徙写不进去，工具会鉴权失败。那种装配下新版卡片同样无法工作（`remote.credentials` 缺席），因此不按「旧用法失效」计档。
- 取服务方式在发布后更正过一次：初版用 `ctx.get('credentials')`，线上拿不到服务，导致工具与迁徙一起失效（v1.6.0/v1.6.1）→ 改为 `inject` + 属性访问。**本记录的决策没变，变的是取服务那一行** → [复盘](../../docs/postmortem/2026-09-15-credential-service-unreachable.md)。
- 传承认领：本记录取代 [密钥配置走原生插件配置表单](2026-09-12-secret-config-via-native-plugin-form.md) 中「密钥按 凭据域 → 设置字面量 → 环境变量 解析」那一条，其余不动。
