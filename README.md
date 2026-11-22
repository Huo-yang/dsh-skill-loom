<h1 align="center">dsh-skill-loom</h1>

<p align="center">为 DSH Web 提供可视化技能编排，把技能和前置依赖组织成角色</p>

<p align="center">将常用技能及其依赖保存为能力族，在不同角色间复用</p>

<p align="center">会话绑定角色后应用人设，只向 Agent 提供角色中依赖完整的技能，精简上下文</p>

<p align="center"><a href="https://www.npmjs.com/package/@huo-yang/dsh-skill-loom"><img src="https://img.shields.io/npm/v/@huo-yang/dsh-skill-loom" alt="npm 版本"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT 许可证"></a> <img src="https://img.shields.io/badge/Node.js-22%2B-brightgreen" alt="Node.js 22 或更新版本"></p>

<p align="center"><strong>简体中文</strong> · <a href="README.en.md">English</a></p>

## 功能

- **角色编排**。拖拽增删技能和依赖，支持搜索、悬停详情、撤销和重做。草稿可在刷新后恢复，保存后才应用。
- **能力族**。把经常一起使用的技能和依赖保存成可复用的子图。
- **会话绑定**。新建会话时选择角色，应用角色人设和该会话的可用技能目录。
- **依赖检查**。缺失技能标红，直接或间接依赖它的技能标灰。
- **Agent 自助编排**。用预置「技能编排助手」创建和调整角色、能力族，并在会话右侧打开结果。

## 兼容性

| 项目 | 要求或验证范围 |
| --- | --- |
| Node.js | 22 或更新版本 |
| DSH 界面 | Web profile |
| 已验证宿主 | Windows 上的 DSH Web 0.2.2-rc.5 |

## 安装

```powershell
dsh plugin --profile web add @huo-yang/dsh-skill-loom
dsh web
```

若 DSH Web 已在运行，重启后从左侧导航栏打开「技能编排」。会话右侧栏也提供同名页签。也可从 [GitHub Releases](https://github.com/Huo-yang/dsh-skill-loom/releases) 下载 `.tgz`，在安装命令里用文件路径替换包名。

## 快速上手

1. **编排角色**。新建角色，将技能从右侧库拖到角色根节点。将技能拖到另一个技能节点可建立依赖。移除技能时，把画布节点拖到下方移除区。
2. **复用能力族**。能力族保存可一起使用的技能和依赖。将能力族拖到角色根节点或某个技能节点，即可纳入缺少的技能和连线。已有技能会复用。
3. **保存并绑定**。技能和依赖的修改先进入草稿，可撤销、重做。点「保存」后才应用。新建 DSH 会话时，从输入框旁选择角色。对话开始后，从标题栏查看或切换当前角色，也可恢复默认角色；会话运行时不可切换。角色简介用于界面展示，人设从画布右上角编辑并注入已绑定会话。
4. **检查依赖**。红色表示技能缺失，灰色表示技能因直接或间接依赖缺失而受阻。悬停技能可查看简介、依赖和纳入状态。

### 让 DSH 帮你编排

新建一个角色，把预置能力族「技能编排助手」拖入角色根节点并保存。用该角色新建 DSH 会话，然后直接描述要创建或调整的角色或能力族。

> 建一个用于审阅项目文档的角色。先确认需要哪些技能和依赖，保存后在当前会话右侧打开技能编排供我检查。

DSH 使用 `role_graph` 编排角色，使用 `role_family` 创建、修改和复用能力族，使用 `role_review` 打开当前 Web 会话的检查侧栏。侧栏已有未保存草稿时，草稿会保留。

## DSH 如何管理技能

Skill Loom 建在 DSH 的技能系统之上，不替换它的技能加载器。流程是：**发现技能 → 按作用域解析同名技能 → 给会话展示目录 → 按需加载正文**。

1. **发现**：DSH 的文件系统提供者从会话的工作目录定位项目，查找 `<技能名>/SKILL.md` 或 `<技能名>.md`。在同一作用域内，默认文件来源按优先级依次为项目的 `.dsh/skills`、项目的 `.agents/skills`、自定义目录、用户的 DSH 技能目录、用户的 Agents 技能目录，以及配置了的内置目录。插件也能注册非文件来源。
2. **解析**：`ctx.skills` 合并宿主全局和当前 Agent 作用域链上的技能。同名时，离当前 Agent 更近的作用域优先；只有在同一作用域内才比较提供者给出的优先级。因此，编排页能看到的技能不一定都能在某个具体会话里解析到。
3. **使用**：DSH 的 `skill` 工具可用时，模型先看到可调用技能的名称与简短描述，需要时再用工具按名读取完整指令。用户的 `/技能名` 调用由独立的可调用设置控制。

**Loom 做什么**：绑定角色时，Loom 按目标 Agent 实际可解析的技能检查角色依赖。依赖完整的成员保留原定义；其余已发现的技能在该 Agent 的作用域内被同名条目覆盖，同时关闭模型和用户调用。解绑会撤销这些覆盖，不修改原技能文件，也不改变 DSH 的文件、命令或网络权限。

以上机制以本项目验证过的版本为参考，见 [DSH 0.2.2-rc.5 技能子系统文档](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/docs/subsystems/skills.md#provider-registry)。

## 会话生效范围

绑定角色后，健康技能进入该会话的可用技能目录，可按需加载正文。缺失、被阻断和未纳入的技能从目录排除，也无法经该会话的技能工具按名加载。Agent 若拥有文件读取权限，仍可用文件工具读取原文件。文件、命令和网络权限由 DSH 控制。

角色、能力族和会话绑定保存在 DSH 数据目录的 `roles` 下。未保存的编排草稿留在当前浏览器。

## 开发

```powershell
npm run check
npm pack --dry-run
```

[贡献指南](CONTRIBUTING.md) · [架构](docs/ARCHITECTURE.md) · [更新记录](CHANGELOG.md)

## 卸载

```powershell
dsh plugin --profile web remove @huo-yang/dsh-skill-loom
```

重启 DSH Web 后生效。卸载插件会保留数据目录中的角色、能力族和绑定记录。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
