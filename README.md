# dsh-zhihu-search

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](.node-version)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--rc.2-blue.svg)](package.json)

给 DSH 装上知乎：站内检索、全网检索与直答三个工具，返回可引用的来源列表，而不是一段无法核对的摘要。

## 能力

- 检索知乎站内问答与文章：按点赞数、评论数或更新时间排序，可按发布时间范围过滤。
- 检索知乎索引中的公开网页：按站点域名与发布时间过滤。
- 调用知乎直答：快问快答、深度思考、智能体三个档位。
- 相同查询在缓存 TTL 内复用结果，减少每日额度消耗。
- 本地令牌桶在额度之外再兜一层，约束单轮对话内的突发请求。
- 搜索结果显示为带作者与点赞数的来源卡片，同时保留纯 Markdown 回退。

## 安装

### 前置

- DSH `0.1.5-rc.2`
- Node `>= 20`

### 从源码安装

```bash
git clone https://github.com/zlZayn/dsh-zhihu-search.git
cd dsh-zhihu-search
npm install && npm run build

dsh plugin --profile web add "$PWD"
```

`dsh plugin` 会把本包装进 profile 并挂进 `dsh.profile.bundles`。重启 `dsh web` 后生效。

### 从 npm 安装

尚未发布到 npm；发布后此命令可用。

```bash
dsh plugin --profile web add dsh-zhihu-search
```

## 配置

### 在设置界面填写

打开 **设置 → 插件 → 插件配置 → 知乎搜索**，填入 Access Secret 并保存。保存后立即生效，无需重启 DSH。

Access Secret 在知乎开放平台的[个人中心](https://developer.zhihu.com/profile)获取。

### 用环境变量代替

不想把密钥存在设置里时，改用环境变量 `ZHIHU_ACCESS_SECRET`；或在卡片的「凭据引用名」里填别的名字，指向另一个环境变量或凭据记录。

## 安全与边界

- Access Secret 只在设置界面、凭据域与环境变量之间流转：不写日志、不以明文进入缓存键、不进仓库。
- 返回内容按外部不可信数据处理：摘要剥离 HTML 标签，链接剥离跟踪参数。
- 只访问 `developer.zhihu.com`，不代理、不转发其他流量。

## 许可

[MIT](LICENSE)。

## 贡献

维护者文档地图见 [AGENTS.md](AGENTS.md)；不变的设计约束见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；发布流程见 [docs/PUBLISHING.md](docs/PUBLISHING.md)。
