<h1 align="center">dsh-skill-loom</h1>

<p align="center">把技能织成角色：用一张依赖图管理「这个会话该看见哪些 skills」</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-orange" alt="Version 0.1.0" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/DSH-0.2.2--rc.5-blue" alt="DSH 0.2.2-rc.5" />
</p>

<p align="center"><strong>简体中文</strong> | <a href="README.en.md">English</a></p>

<p align="center">
  <a href="#功能">功能</a> ·
  <a href="#安装">安装</a> ·
  <a href="#使用">使用</a> ·
  <a href="#数据与安全边界">数据</a> ·
  <a href="docs/ARCHITECTURE.md">架构设计</a> ·
  <a href="CHANGELOG.md">更新记录</a>
</p>

---

## 要解决的问题

DSH 的技能目录是进程级共享的：所有会话看到同一份 `<available_skills>`。技能装到几十个之后，每个请求都要携带全部技能的名称与描述，既占上下文，也让模型在过多候选里挑不准。

现有两条路都不完整：

| 方案 | 机制 | 缺口 |
|---|---|---|
| Agent Preset | 会话创建时选一个插件子集 | 会话一开始就锁死 |
| 技能管理类插件 | 分组过滤、按需暴露、逐项裁剪 | 没有「角色」这个整体 |

`dsh-skill-loom` 的立场：**技能之间存在依赖，依赖应该被画出来**；角色是这张图的根，会话按角色收窄可用技能。

## 功能

- **角色 = 一张依赖图**。角色是根，技能是节点，`requires` 是边。一个角色一个文件，删除角色即删除整张图。
- **可视化编排**。图上从上到下是「角色 → 依赖 → 被依赖」；拖节点建依赖、拖技能进图、拖到删除区移除、拖会话到角色节点完成绑定。
- **agent 可编排**。`role_graph` 工具让 agent 直接建角色、改成员、连线、试算；`role_spawn` 让子代理运行在指定角色下。
- **会话级生效**。绑定后只影响该会话的技能目录，其他会话不受影响。
- **缺失可见**。技能被删除或改名时节点标红、其下游标灰，并给出「文件还在但没被加载」这类可执行的诊断。

## 要求

- DSH Web `0.2.2-rc.5`（本仓库在该版本实测）。
- Node.js 22+。
- 只支持 Web profile（依赖客户端插槽）。

## 安装

```powershell
# 1) 把包装进 profile
dsh plugin --profile web add "D:\CodeSpace\personal\DSH_Plugin\dsh-skill-loom"

# 2) 注册为 bundle（推荐用 agent 的 plugin_manager 工具：
#    action=install_bundle, target=<上面的绝对路径>）

# 3) 首次安装必须重启一次 dsh web：客户端模块在启动时构建
dsh web
```

之后修改宿主代码用 `plugin_manager` 的 disable + enable 即可生效；**新增客户端模块**才需要重启。

左侧导航栏在「插件」与「自动化任务」之间出现「技能编排」；右侧边栏可再开一个紧凑版页签，用于边对话边编排。

## 使用

### 让 agent 编排

直接说需求即可，例如：

> 建一个「审阅」角色，只要代码审阅和 git 相关的技能，不要写文件。

agent 会调用 `role_graph`：`plan` 试算 → `create` / `add_members` / `link` → 返回结果。删除角色不在 agent 工具面内，只走界面。

### 在界面上编排

| 操作 | 方式 |
|---|---|
| 纳入技能 | 从右侧列表把技能拖到**角色节点**上 |
| 建立依赖 | 从列表把技能拖到**另一个技能节点**上（落点依赖被拖动的技能） |
| 移除成员 | 抓节点左侧握把，拖到底部「拖到此处移除」区域 |
| 删除依赖 | 拖动连线的中点，移开即删除 |
| 绑定会话 | 把角色卡里的会话条拖到角色节点上；点「解绑」解除 |
| 改人设 | 右侧详情区（未选中技能时）编辑 persona 并保存 |

### 会话级生效

绑定后，该会话的 `<available_skills>` 只保留角色纳入且健康的技能，其余在本会话内不可见、也不可被 `skill` 工具按名加载。

## 数据与安全边界

- 角色图：`$DSH_HOME/roles/<uuid>.json`（原子写、按角色独立 revision）。
- 会话绑定：`$DSH_HOME/roles/bindings.json`。
- 只读接口 `GET /skill-loom/roles`、`GET /skill-loom/sessions`；写接口只接受成员、连线、人设、删除与会话绑定这几类动作，且校验同源、限制请求体大小。
- **卸载不会自动删除角色数据**；需要清理时手动删除上述目录。
- 角色只决定「这个会话能看见哪些技能」，不是操作系统级沙箱；文件与命令仍受 DSH 全局策略约束。

## 开发

```powershell
cd D:\CodeSpace\personal\DSH_Plugin\dsh-skill-loom
node --test          # 172 条单元测试
```

无构建步骤：宿主与客户端都是纯 ESM JavaScript，客户端模块直接以 `window.__ModuleLoader__.load` 格式分发。

## 许可证

[MIT](LICENSE)
