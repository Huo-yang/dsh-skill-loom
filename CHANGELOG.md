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

### 修复 / Fixed

- 插件卸载后防抖定时器仍访问宿主服务，导致 `fatal load failure`。现在定时器与事件回调都带存活检查，异常不再逃逸到事件循环。
- 绑定文件曾写到 `$DSH_HOME/bindings.json`，已改为 `$DSH_HOME/roles/bindings.json`。

### 新增 / Added

- `role_spawn` 工具：为子代理显式指定角色；子代理默认继承父会话角色。角色解析顺序为 override → 继承 → 自身绑定，失效的候选会被跳过而不是中止。
- 子会话的角色绑定会被持久化，插件重载后仍可恢复。

### 测试 / Tests

- 111 条测试，其中生命周期相关 12 条：防抖存活、卸载后不执行、取消竞态、teardown 幂等与容错。

### 说明 / Notes

- M1 与 M2 运行时已在真实 DSH 0.2.2-rc.5 验证：绑定后宿主目录清空、解绑后恢复。
