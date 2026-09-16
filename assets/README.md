# assets/ — 展示图

两份 README 引用的展示图都住在这里；触发判据、截图步骤与验收见 [AGENTS.md](AGENTS.md)。

## 文件与引用面

- `banner.svg`：头图，双语共用，被 [README.md](../README.md) 与 [README_en.md](../README_en.md) 引用。
- `zhihu-daily-quota.jpg`：知乎开放平台「各接口剩余配额」面板的截图，双语 README 共用（**额度**按自然日刷新，这张图是静态截图、不随日更换）。
- `banner.jpg`、`logo.jpg`、`logo.svg`、`slogan.jpg`、`slogan.svg`：未引用。
- `settings-card.png`：设置卡片截图（中文），被 [README.md](../README.md) 引用。
- `settings-card_en.png`：设置卡片截图（英文），被 [README_en.md](../README_en.md) 引用。

两份 README 都以 `width=600` 展示。
`assets/` **不进 npm 包**：npm 会把 README 的相对图片路径改写到默认分支的 raw 地址，线上展示跟的是 `main` 上的图 —— **改图等于同时改所有历史版本的展示**。

## 风格基准

新图与现有图保持一致；要不要换风格是维护者的决定，截图的人不自行改。

| 项 | 基准 |
| --- | --- |
| 尺寸 | 不写死像素：只截页面内容（不含浏览器标签栏 / 书签栏），随窗口实测视口，中英两张一致（整屏拿不到，见 [AGENTS.md](AGENTS.md)） |
| 侧边栏 | 左右都收起 |
| 背景 | 空会话 |
| 主题 | 浅色 |
| 卡片 | 展开、完整可见 |
| 两张的关系 | 只有界面语言不同 |

开关状态**不属基准** —— 规则与理由见 [AGENTS.md](AGENTS.md)。

## 与发版的关系

`assets/` 是非产物（[release-guard.mjs](../scripts/release-guard.mjs) 的 `NON_ARTIFACT_PREFIXES`）。
重截图不触发发版，搭引起它的那次 UI 改动一起走；只含 assets 的区间会被守卫拦下（需 `force`）。
判例：`d0a3adb` 只改 assets + 两处 `.md`，未发版，`git tag --contains d0a3adb` → `v1.4.0`（搭车）。

## 变更影响路由

- 改卡片渲染面 → **必须同批重截**两张卡片图，判据与步骤见 [AGENTS.md](AGENTS.md)。
- 换图本身 → 两份 README 无需改（路径与 `width` 不变）；只有文件改名才要同步两份 README 与本目录两份文档。
