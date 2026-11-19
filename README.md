<h1 align="center">dsh-skill-loom</h1>

<p align="center">把技能织成角色：用一张依赖图管理「这个会话该看见哪些 skills」</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.0.0--design-lightgrey" alt="Design stage" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/DSH-0.2.2--rc.5-blue" alt="DSH 0.2.2-rc.5" />
</p>

<p align="center"><strong>简体中文</strong> | <a href="README.en.md">English</a></p>

<p align="center">
  <a href="#状态">状态</a> ·
  <a href="#要解决的问题">要解决的问题</a> ·
  <a href="#核心概念">核心概念</a> ·
  <a href="docs/ARCHITECTURE.md">架构设计</a> ·
  <a href="CHANGELOG.md">更新记录</a>
</p>

---

> **当前状态：设计阶段。** 本仓库还没有可安装的插件代码，只有一份经过多轮评审的架构设计。安装命令将在 M1 完成后给出。

## 要解决的问题

DSH 的技能目录是进程级共享的：所有会话看到同一份 `<available_skills>`。技能装到几十个之后，每个请求都要携带全部技能的名称与描述，既占上下文，也让模型在过多候选里挑不准。

现有的两条路都不完整：

| 方案 | 机制 | 缺口 |
|---|---|---|
| Agent Preset | 会话创建时选一个插件子集 | 会话一开始就锁死，不能换 |
| 技能管理类插件 | 分组过滤、按需暴露、逐项裁剪 | 没有「角色」这个整体，切换是逐个开关 |

`dsh-skill-loom` 的立场：**技能之间存在依赖，依赖应该被画出来，而不是靠人记在脑子里。**

## 核心概念

| 概念 | 定义 |
|---|---|
| **仓库** | 对 DSH 六个技能根的只读聚合视图，不复制、不移动、不改写存量技能 |
| **角色图** | 一个角色的全部编排状态，存在一个 JSON 文件里；角色本身即 DAG 的根 |
| **红节点** | 图里引用了、仓库里查不到（技能被删、改名或 frontmatter 损坏） |
| **灰节点** | 自身存在，但依赖链上游有红或灰；**不进运行时集合** |
| **健康集合** | 角色纳入的节点中非红非灰的那部分，即会话实际能看见的技能 |

一句话：**图是意图，仓库是事实，两者的差集就是可观测性。**

## 设计要点

- **一角色一图一文件**：删除角色即删除该图，revision 按角色本地，改 A 不会锁住 B。
- **DAG 不做分层**：层级是推导出来的（按根计算），不是作者填的字段。作者填的层会腐化。
- **缺失可见**：红点标注缺失，其下游整条链变灰并从运行时排除。
- **agent 可以编排**：用户只描述「我要一个审阅角色」，agent 自己建图；人可以在画布上核对与微调。
- **零侵入原生**：只使用文档化的宿主服务与客户端插槽，不 monkey-patch、不 fork、不改 profile 结构。

## 文档

- [架构设计](docs/ARCHITECTURE.md) —— 决策记录、数据模型、运行时语义、与原生 DSH 的干涉面、里程碑。

## 计划

| 阶段 | 内容 |
|---|---|
| M1 | 单角色文件存储 + DAG 校验 + `role_graph` 工具（含 `plan` 预演） |
| M2 | 运行时应用（健康集合 → 影子 + persona）+ `role_spawn` |
| M3 | 只读图 UI（观测性） |
| M4 | 可编辑图 UI（操作性） |
| M5 | 并发、审计、导入导出 |

## 许可证

[MIT](LICENSE)
