# 声明面：整条抬到 alpha 线（旧线的例外作废）

> 取代 [2026-09-20-declaration-floor-stays-on-next.md](2026-09-20-declaration-floor-stays-on-next.md)
> 的**决策**（那份记录的事实仍然真实：那天确实抬不动）。
> 与之同批的是设置接缝迁移，见 [2026-09-22-settings-seam-migration.md](2026-09-22-settings-seam-migration.md)。

## 问题

`engines.dsh` 的下限在 alpha 线，而 27 条 `@deepseek-ai/dsh-*` 声明停在 next 线 ——
**声明面自相矛盾**。使用者按我们给的区间装出来的宿主，未必有本插件赖以工作的设置接缝，
而接缝缺席是**静默**的（配置页不出现、宿主不报错）。

2026-09-20 试过一次，抬不动：`npm install` 解得开，但 `npm run build` 里 `tsc` 报

```
src/index.ts(404,27): error TS2345: Type 'void' is not assignable to type 'Promise<undefined> | undefined'
```

## 这次的事实（2026-09-22 实测）

1. **那条类型错一行就能修**，而且 `compat.yml` 早就记过这招：`agent/created` 的 handler
   显式 `return undefined` 即可同时满足两条线。0.1.7-alpha.1 上它仍然复现，也仍然只需这一行。
2. **裸 `npm install` 不需要 `--force` 了**：删掉旧锁文件与旧树之后，
   108 个包装完 **exit 0**（23 秒）。2026-09-20 那次失败的直接原因是**旧锁文件把树钉在 next 线**，
   不是 alpha 线本身解不开 —— 同一份 package.json、同一台机器，差别只在有没有旧树。
   → `compat.yml` 里「alpha 必须 `--force`，因为包内部 peer 图没定型」那段论证**可能已经过期**，
   本轮**不动它**（要动得先用一轮实跑复核），记进遗留项。
3. **本机在 alpha 线上全绿**：`npm run build` / `npm run typecheck` / `npm test` 全部 exit 0
   （276 条测试通过），`node scripts/compat-swap.mjs check alpha` exit 0。
4. `@deepseek-ai/dsh-code-runtime` **删掉了**：dev-only、全仓零引用，而且它在 alpha 线上停在
   `0.1.5-alpha.2`（比 next 还旧）—— 它正是「抬不动」里唯一一个连版本都对不上的包。删掉即消失。

## 决策

**整条声明面抬到 alpha 线，形状统一成 `>=0.1.7-alpha.1 <0.2.0`**：

- `engines.dsh` 与 **全部 27 条** `@deepseek-ai/dsh-*`（9 条 peer + 18 条 dev，去重 18 个包）**同一条区间字符串**。
  上界保留 `<0.2.0`：与从前 `^0.1.5-rc.2` 的「封套」语义一致，0.2.0 一发布不会被自动吃进来。
- 新增 dev-only 的 `@deepseek-ai/cordis-plugin-loader@^1.0.4`：只为 `loader/volatile-update` 的事件声明。
  判断依据仍是**我们只 `import type`**，不是包住在哪一侧。
- **`compat.yml` 两个 job 的角色对调**：`alpha`（承诺线）红了必须修、会发通知；
  `next`（已低于声明下限）红了只记录、不阻断。`declaration` 作业**只查 alpha** ——
  一条长期必红的周更任务会让「红 = 出事」这个信号失效，噪音掩盖真问题比少一条巡逻更糟。
- **换包写回改成保形的**（`scripts/compat-swap.mjs`）：只替换区间里的下限版本，比较符与上界原样留下。
  从前写回裸精确版本会把 `>=… <0.2.0` 整条抹平成 `0.1.7-alpha.1` —— 声明面在 CI 里悄悄变形，而人只看到 job 绿。
  实现上有个坑值得记：**「区间里读不出版本号」必须用 `test()` 判，不能拿替换结果与原串比** ——
  目标版本与下限**恰好相同**时替换是空操作，比字符串会把它误判成「没有版本号」而退回裸版本，形状照样丢（实测踩到）。
- **断言**：`test/redlines.test.ts` 新增「`engines.dsh` 与全部 `dsh-*` 下限一致且不低」一组
  （跨仓规则 7）—— 这条**从前写必红**，所以那时没写。

## 影响

- 旧宿主装不上（peer 不满足），使用者要显式装 `alpha` 线；两份 README 的「前置」与「版本兼容」已同批改。
- **下一次触发点**：alpha 线一挪到 `0.1.8-alpha.1`，`>=0.1.7-alpha.1` 就不再命中它
  （预发布只在同一 `major.minor.patch` 元组内被放行）—— 这是声明面必须再抬一次的信号，
  `compat.yml` 的 `declaration` 作业就是那个探针。
- 遗留：`compat.yml` 的 alpha job 仍带 `--force`（见上面第 2 条）；`admin` 侧无改动。
