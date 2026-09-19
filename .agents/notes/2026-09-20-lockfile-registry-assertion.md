# 锁文件的 resolved 必须指向官方源：从发布手册的散文变成红线

## 问题

「`package-lock.json` 的 `resolved` 必须指向 `registry.npmjs.org`」这条规则已经写在
[docs/PUBLISHING.md 的「前置条件」](../docs/PUBLISHING.md) 里 —— 但它是**散文**：
本仓的锁文件一直是干净的（131/131 官方源），可**没有任何东西在守它**。

同源的另一仓（`dsh-ds-balance`）正是这条规则的失败案例：它的锁文件有 129/131 条指向
`registry.npmmirror.com`，而 CI 长期全绿 —— 规则住在文字里，就只会被读到它的人执行一次。

## 决策

**在 `test/redlines.test.ts` 新增「锁文件」组**：读 `package-lock.json` 的 `packages[*].resolved`，
断言 http(s) 来源必须落在 `https://registry.npmjs.org/`；失败信息点出**是哪些包、指向了哪个 host**。

同时把 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 那条前置条件的口径改成「已落成红线，别再靠人核对」。

## 替代方案

- **只保留手册里的散文** —— 否。这正是它失效的形态：另一仓违反了几个月而没人发现。
- **把 registry 写进 `.npmrc` 提交进仓** —— 否。`.npmrc` 会影响所有使用者的解析行为；
  我们要管的是**本仓锁文件的内容**，不是使用者的网络。
- **放到 CI 里做一步 shell 检查** —— 否。红线是一处统一的地方，
  再开一个 CI 步骤会让"什么被守卫着"分散到两处。

## 影响

- 镜像再回到锁文件里会**当场红**，并点名是哪些包 —— 这次它会响。
- 该断言只看 http(s) 来源，`file:` / `link:` / git 依赖不受影响。
