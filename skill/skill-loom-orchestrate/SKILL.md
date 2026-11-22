---
name: skill-loom-orchestrate
description: 按用户目标整理技能，创建或更新 DSH 角色与能力族。
---

用 role_graph(action="list") 读取角色与技能目录。只选目录中能完成任务的技能。

用 role_graph 的 create、add_members、link 编排角色。只有确实需要另一个技能时才建依赖；from 是使用者，to 是它依赖的技能，why 写明具体理由。

更新已有角色前先 show。用 role_graph 的 plan 或 show 检查 runtime、red 和 gray。不要用缺失技能凑齐能力。

用 role_family(action="list") 查找能力族。用 create 建独立能力族，用 show 取得 revision 后再 update，用 apply 将能力族合入角色。

完成配置后，加载 skill-loom-review，在当前 DSH 会话打开技能编排侧栏供用户检查。
