# 决策：走 awesome-dsh-plugin 注册表文件投稿，PR 延后到仓库满一天（2026-09-12）

条目文件已提交到 fork 分支，PR 尚未开——被仓库年龄闸门挡住，见下。

## 问题

让插件进入 DSH 社区插件市场。任务书给的目标仓库是 `dsh-market/awesome-dsh-plugin`，实测不存在。

## 实测事实（2026-09-12）

- 真正的精选列表是 **`awesome-dsh-plugin/awesome-dsh-plugin`**，也是 `awesome-dsh-plugin.com` 的数据源。
- 它的两个 README **由脚本生成，不接受手工编辑**。唯一投稿产物是 `data/plugins/<owner>__<repo>.yml`，一个插件一个文件——这样 PR 之间永不冲突。
- 三条硬性要求：`package.json` 声明 `dsh.bundle`、仓库创建满 **1 天**、仓库带 `dsh-plugin` topic。第一条与第三条已满足；**第二条卡住**：仓库创建于 `2026-09-12T17:19:21Z`，写这份记录时只过了 1 小时。
- 仓库年龄由 CI 自动校验，提前提交必然红。贡献指南对此的原话是「差一点就做完再来，重新提交不会留档」——所以等，比开一个必红的 PR 更对。
- `dsh-plugin.org` 不是表单投稿：公开仓库 → 加 `dsh-plugin` topic → README 含安装命令且导出 `apply(ctx)`。四条全中后由爬虫自动收录，无需人工提交。

## 决策

1. 投稿只新增注册表文件，不碰 README。
2. PR 延后到 `2026-09-13T17:19:21Z`（本地 2026-09-14 01:19）之后。

## 已就位

- `zlZayn/dsh-zhihu-search`：带上必需的 `dsh-plugin` topic，并按发现入口补齐 `search`、`ai`、`ai-agent`、`agent-harness`、`deepseek`、`llm`；description 补上第三个工具与来源引用。
- `zlZayn/awesome-dsh-plugin` 分支 `add-dsh-zhihu-search`：已含 `data/plugins/zlZayn__dsh-zhihu-search.yml`，相对上游 `main` 领先 1 个文件。

## 待执行（时间到了只跑这一条）

```sh
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --head zlZayn:add-dsh-zhihu-search \
  --title "Add dsh-zhihu-search" \
  --body "Add [`dsh-zhihu-search`](https://github.com/zlZayn/dsh-zhihu-search) — three Zhihu tools for DSH: in-site Q&A and article search, Zhihu's global web index with domain and date filters, and Zhida answers. Search results render as source cards carrying author and vote counts, and the package ships a native settings card for the Access Secret.

- npm: https://www.npmjs.com/package/dsh-zhihu-search
- Install: `dsh plugin --profile web add dsh-zhihu-search`
- `package.json` declares `dsh.bundle` and `dsh.client`
- Repo carries the `dsh-plugin` topic"
```

## 影响

- `dsh-plugin.org` 与任何扫 topic 的市场在这一步之后就会爬到，不需要等 PR。
- `awesome-dsh-plugin` 系（含 `dsh-market` 的界面）要等 PR 合并才会出现。
