# 更新记录 / Changelog

## [Unreleased]

### 新增 / Added

- 角色图模型：单个角色一个文件、UUID 作为存储键、显示名中英文均可且唯一。
- 依赖语义：`requires` 边构成 DAG，支持闭包解析、环检测、拓扑层级推导、冲突校验。
- 红/灰状态：名字解析不到为红，沿 `requires` 反向可达红点的为灰；两者都不进入运行时集合（连坐）。
- 技能锚点：保存时记录 `path` / `source` / `provider`，用于解释红色成因与发现重装漂移；永不参与解析。
- 持久化：原子写、每角色 revision、并发冲突检测、损坏文件隔离。
- `role_graph` 工具：`help` / `list` / `show` / `plan` / `create` / `set_name` / `set_persona` / `add_members` / `remove_members` / `link` / `unlink` / `duplicate` / `bind` / `unbind`。
- 运行时应用：按角色在 agent 作用域注册同名影子（两个调用开关均关闭）与 persona 段，会话绑定持久化在 `roles/bindings.json`，技能目录变化时防抖重建。
- English: role graph model, DAG semantics with cascading exclusion, skill anchors for missing-skill explanation, per-role atomic storage with revisions, and the `role_graph` tool.

### 说明 / Notes

- M1 与 M2 运行时已在真实 DSH 0.2.2-rc.5 验证：绑定后宿主目录清空、解绑后恢复。
