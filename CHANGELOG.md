# 更新记录 / Changelog

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
