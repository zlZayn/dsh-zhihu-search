# 决策：工具面按「Agent 第一人称」重写（2026-09-14）

已实施。

## 问题

工具面是写给模型的，但按人类的散文习惯写，于是出现三类只有从模型视角才看得见的缺陷：

1. **语义欺骗**：`minValue` 写成「表示只要点赞数 ≥ 100 的结果」，而上游的区间只筛**本次检索到的候选**。
   模型据此把候选内筛选读成全库过滤，会说出「知乎只有 3 篇高赞文章」。
2. **盲盒**：函数调用模式下宿主只发 `{name, description, parameters}`（DSH 两个 provider 一致），
   `output.schema` 不进上下文 —— 模型在首次调用前不知道结果里有点赞数、评论数、时间，也不知道外站页面没有这些数值。
3. **重复与不对称**：`zhihu_global_search` 的描述里写着 `count` 与 `site` 的取值（参数说明里已有），
   而 `zhihu_search` 的描述没提「没有翻页」，两个工具对同一条硬边界说法不一。

## 决策

- **诚实优先**：`minValue` 说明改成「只筛本次检索到的候选，不是全库过滤；达标项不足时返回条数会少于 count」，
  并直接点破错误结论（「不要据此断定知乎没有高赞内容」）。
- **结果形态槽「剧透」**：两个搜索工具的描述写明拿到什么（标题/链接/摘要/作者/点赞数/评论数/时间）、
  拿不到什么（不含图片）、以及没有翻页参数。
- **依赖用标记，拦截在本地**：`order` / `minValue` 加 `[依赖 sortField]` 前缀；真正的拦截仍在 `execute`（`kind: 'param'` + hint，不发请求）。
- **去重与对称**：删掉描述里对 `count` / `site` 取值的复述；两个搜索工具统一写明「没有翻页参数」。

## 替代方案

- **把依赖写进 JSON Schema**（`dependentRequired` / `minimum` / `maximum`）：**实测被 DSH 拒绝** ——
  `unsupported JSON schema: parameters.minValue.dependentRequired is not supported by the value schema DSL`。
  同一个 DSL 也不接受 `minimum` / `maximum`，所以数字边界只能留在描述文本里。
- **用 `oneOf` 表达依赖**：子集虽支持 `oneOf`，但它要求「恰好命中一个分支」，而缺少 `not` 就写不出
  「不给 sortField 时不得给 minValue」；合法组合反而会因同时命中两个分支而失败。
- **把 `editTime` 改名 `time`**：参数改名按 [docs/PUBLISHING.md](../../docs/PUBLISHING.md) 的问题链属 Q2 → major，
  而收益只是措辞；改为在 `sortField` 说明里注明「时间（发布或最后编辑，由上游决定）」。
- **只在渲染层兜底**（1.4.1 的现状）：那只纠正**调用之后**的解释，纠正不了**调用之前**的判断。

## 影响

- 模型面：描述 407 → 约 420 字；参数说明里 `minValue` 一条变长，换来语义与物理行为一致。
- 三条不变量以测试固化（[test/tool.test.ts](../../test/tool.test.ts)）：结果形态槽必须写全、`minValue` 必须写明候选内筛选、耦合参数必须带 `[依赖 sortField]`。
- 档位：描述是模型可见面，重写它属「模型能观察到新信息/更好择路」→ **minor**。

## 关联

- [架构说明](../../docs/ARCHITECTURE.md) 的「工具描述约定」
- [根 README](../../README.md) 的参数字典（`minValue` 行同步了同一句诚实陈述）
