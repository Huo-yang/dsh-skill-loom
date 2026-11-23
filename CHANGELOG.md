# 更新记录 / Changelog

## 0.1.4

- 技能库悬停始终提供简介与来源，不再要求角色画布；图和计划就绪后才显示纳入状态及依赖关系。
- Skill-library hover details always show description and source; membership and dependencies require a ready graph and plan.

## 0.1.3

- 中英文 README 统一使用插件名，并在开头概括角色编排、能力族与会话技能范围。
- 内置技能移至包内的 `skills/` 目录。

### English

- Both READMEs use the plugin name and open with a summary of role editing, ability families, and session skill scope.
- Bundled skills now live under `skills/` in the package.

## 0.1.2

- 技能编排界面和预置能力族跟随 DSH 的中英文设置。
- 内置编排与审阅技能以英文 `SKILL.md` 随插件打包。
- 重整中英文 README，补齐安装、快速上手、卸载和许可证章节。

### English

- The Skill Loom UI and preset family follow the DSH language setting for Chinese and English.
- The built-in orchestration and review skills ship as English `SKILL.md` files.
- Both READMEs now cover installation, quick start, uninstallation, and licensing in dedicated sections.

## 0.1.1

- 已开始的会话可在标题栏查看当前角色、切换角色或恢复默认。新建会话仍从输入框旁选择。
- 会话运行中禁止切换角色；读取或切换失败时会显示提示。
- 中英文 README 新增 DSH 技能发现、作用域、调用方式，以及 Loom 的会话级技能筛选说明。

### English

- View or switch a role, or restore the default, from an active conversation's header. The composer still offers a role picker for new sessions.
- Role changes are unavailable while the session is running. The picker shows errors if reading or changing the role fails.
- Both READMEs explain DSH skill discovery, scope and invocation, and how Loom filters skills per session.

## 0.1.0

- 角色与能力族依赖图，支持拖拽编排、搜索、悬停详情和确认删除。
- 编排草稿支持撤销、重做与刷新后恢复。角色编排在保存后生效。
- 会话级角色绑定和人设注入。缺失技能标红，直接和间接受阻技能标灰，均从会话可用技能目录排除。
- 预置「技能编排助手」能力族。DSH 可通过 role_graph 和 role_family 编排，并用 role_review 在当前会话右侧打开结果。
- 验证宿主为 Windows 上的 DSH Web 0.2.2-rc.5。

### English

- Visual DAGs for roles and ability families, with drag and drop, search, hover details and deletion confirmation.
- Graph drafts with undo, redo and browser recovery. Role graph edits take effect when saved.
- Per-session persona and skill selection. Missing nodes are red and directly or indirectly blocked nodes are gray. Both are omitted from the session skill catalog.
- Built-in orchestration family. DSH can edit graphs with role_graph and role_family, and open them in the current conversation with role_review.
- Verified with DSH Web 0.2.2-rc.5 on Windows.
