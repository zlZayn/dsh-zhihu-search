# notes/ — 决策记录

- 职责：记录「为什么这样设计」——问题、决策、替代方案、影响。
- 不属它：迁移计划、验收清单、spec 式「应该…」，那些归 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 或计划文档。

## 目录结构

```
notes/
├── AGENTS.md                     # 规则层：状态标记 / 命名 / 归档
├── README.md                     # 本文：结构 / 去哪查 / 改哪
├── YYYY-MM-DD-<主题>.md          # 一条决策一档
└── archived/                     # 已归档，按需建立
    └── YYYY-MM-DD-<主题>.md
```

## 命名约定

- 文件名 `YYYY-MM-DD-<主题>.md`；日期是**首次提出**那天，不是归档那天。
- 主题用 kebab-case 英文小写，不缩写到无法理解。

## 状态含义

- 状态行在第 3 行，四值：`生效` / `被取代` / `已否决` / `已归档`。
- 四种写法与归档判据见 [AGENTS.md](AGENTS.md)。

## 去哪查

- 当前有效：目录里 `状态：生效` 的篇目。
- 已退场：`archived/`，以及 `状态：被取代` / `状态：已否决` 的篇目。
- 不变的设计与约束 → [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)。
- 工作规则 → [AGENTS.md](AGENTS.md)。

## 改哪（变更影响路由）

- 决策反转 → 新写一条并交叉引用；旧记录只改状态行，正文不动。
- 决策失效 → 移入 `archived/` 并改状态行。
- 改本目录规则 → [AGENTS.md](AGENTS.md)；改完跑一次链接校验。
- 新增记录后 → 回查根 [AGENTS.md](../../AGENTS.md) 的文档地图与待办是否要同步。
