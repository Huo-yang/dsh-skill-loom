# dsh-skill-loom 架构设计

> 状态：**v3.2（M1–M3 完成；M4a 成员增删、M4b 连线可视化与编辑已上线；156 条测试）**
> 设计核对版本：DSH Web `0.2.2-rc.5`
> 一句话：**一个角色 = 一张图 = 一个文件**；技能是节点，连线是依赖；agent 与人共用同一张图的读写面。

---

## 0. 已定决策（决策记录）

| # | 决策 | 版本 |
|---|---|---|
| D1 | 角色是图的根节点，技能是普通节点 | v1.0 |
| D2 | 技能仓库是只读投影，不复制、不移动、不迁移存量技能 | v1.0 |
| D3 | 依赖边由插件维护，独立存储，不写入 SKILL.md | v1.0 |
| D4 | 数据模型为 DAG（无分层、无 taxonomy） | v1.0 |
| D5 | 缺失技能节点标红；**沿 requires 反向可达红点的节点**标灰（传递） | v1.0 → v1.6 |
| D6 | **灰点不进运行时集合（连坐）**：灰等于事实上不可用 | v1.0 → v1.6 |
| D7 | 第一阶段模型侧不感知依赖；依赖只用于编排、校验与展示 | v1.0 |
| D8 | 角色不含模型 | v1.0 |
| D9 | 默认（无角色）走 DSH 原生技能注入逻辑 | v1.0 |
| D10 | agent 可感知并操作编排，但**不能删除角色** | v1.1 |
| D11 | 建边必须能填 `why`；**agent 强制、人手可选** | v1.1 |
| D12 | **一个角色一张图，一个角色一个文件**；删除角色即删除该图 | v1.1 |
| D13 | 子代理**默认继承**父会话角色；父会话可通过 `role_spawn` 为子代理**显式指定**角色 | v1.2 |
| D14 | 缺依赖时**宽松保存，但需显式确认** | v1.2 |
| D15 | agent 不设"只增不减"限制；`update` 改为**增量原语**（`add_members` / `remove_members`），降低往返与误操作面 | v1.2 |
| D16 | `why` **对 agent 可见**：`show` 默认返回边上的 `why`，让 agent 理解既有编排的意图 | v1.3 |
| D17 | 暂不为 `agent-team` 并行建队单独做角色路径；成员继承父会话角色 | v1.3 |
| D18 | 角色 id 用 **UUID**，作为存储键与文件名；显示用 `name` | v1.4 |
| D19 | `name` 支持中英文与 emoji，大小写不敏感地全局唯一 | v1.4 |
| D20 | 保存时把整个 `requires` 闭包补进 `members`；解析不到的节点保留为红点 | v1.4 |
| D21 | 运行时集合 = 闭包 − 红 − 灰；不做"部分可用"的中间态 | v1.6 |
| D22 | 灰沿 `requires` 反向**传递**；灰必须由红派生，无红必无灰（代码断言） | v1.6 |
| D23 | 技能锚点仅作建议：不参与解析、跨机器不保证有效、导出时剥离 | v1.7 |
| D24 | 锚点的用途是**解释红色**：名称决定可用性，锚点只回答"为什么不能用、去哪修"，不引入新状态 | v1.9 |

### 暂不做（明确排除，防止范围蔓延）

- `assumes`（事实依赖）：模型侧不感知依赖，无人消费。
- `sequence`（时序边）：与集合约束混在一起会破坏 DAG 语义。
- `provides`（能力供给）：引入技能 ↔ 插件第二套依赖维度。
- 分层 / taxonomy（契约 / 方法 / 领域 / 任务）：见 §4.2 废止理由。
- 自动安装缺失技能：那是包管理。
- 跨角色共享子图：会重新引入耦合，见 §3.4 的对冲方案。

---

## 1. 目标

1. 一个可视化工作台：**逐角色**编辑以角色为根、技能为节点、连线为依赖的 DAG。
2. 用户只描述"我要什么角色"，agent 即可完成编排；人可在图上核对与微调。
3. 角色在会话级生效：会话只看见该角色解析出的健康技能集合。
4. 缺失与受阻必须**可见**，不允许静默失效。

### 非目标

- 不切换 agent preset。
- 不做全局 / 进程级能力切换。
- 不管理技能文件（创建 / 删除 / 导入 SKILL.md 归 skill-hub / skill-cockpit）。
- 不做技能正文的内容编排（DAG 只表达"谁需要谁"，不表达"把 A 的产出喂给 B"）。
- 不做多角色合并的大图。

---

## 2. 核心概念

| 概念 | 定义 |
|---|---|
| **仓库（Repository）** | 对 DSH 六个技能根的只读聚合视图：bundled / user-dsh / user-agents / custom / project-dsh / project-agents。**不复制、不移动、不改写。** |
| **角色图（Role Graph）** | 一个角色的全部编排状态，落在一个文件里。角色本身即根，图中不设角色节点。 |
| **成员（Members）** | 角色直接纳入的技能，即图的根集合。 |
| **运行时集合（Runtime Set）** | 闭包中非红、非灰的那部分 —— 即会话实际能看见的技能。 |
| **红** | 图中引用了、仓库里查不到。 |
| **灰** | 自身可解析，但依赖链上可达红点 —— 视为**事实上缺失**，一并排除。 |

### 2.1 两态分离：图是意图，仓库是事实

观测性的来源：

| 图里有 | 仓库里有 | 展示 | 运行时 |
|---|---|---|---|
| ✅ | ✅ | 实心 | 纳入 |
| ✅ | ❌ | **红** | 排除 |
| ✅ | 存在但被压制 / 同名遮蔽 | 空心（另一原因） | 排除 |
| ✅（成员或依赖） | 依赖链上可达红点 | **灰** | **排除（D6）** |
| ❌ | ✅ | 未编排（侧边托盘） | 与本角色无关 |

**关键实现要求**：图必须能表达"曾经引用过、但现在仓库里没有"的技能。因为节点集合是从 `members ∪ edges 端点` **推导**出来的（§3.1），被引用过的名字天然留在文件里，所以技能被删后红点仍然成立——无需额外的节点记录表。

> 红 = 文件里引用了这个名字，而仓库解析不到它。

---

## 3. 数据模型

### 3.1 单角色文件：`$DSH_HOME/roles/<roleId>.json`

```jsonc
{
  "schema": 1,
  "revision": 12,
  "id": "3f2a6c1e-9b4d-4e21-8a77-1c5b0d9e4f60",
  "name": "审阅",
  "icon": "🔍",
  "order": 10,
  "description": "只读审阅改动，给分级结论",

  "persona": {
    "prefix": "You review software changes. Cite file:line and grade findings P0/P1/P2.",
    "suffix": "",
    "includeRuntimeContext": true
  },

  "members": ["code-review", "git-workflow"],

  "edges": [
    { "from": "code-review", "to": "git-workflow",
      "why": "需要读提交历史来定位回归点" }
  ],

  "conflicts": [["concise-writing", "verbose-report"]],

  "anchors": {
    "code-review": { "path": "/home/u/.agents/skills/code-review/SKILL.md", "source": "user-agents", "provider": "filesystem" },
    "git-workflow": { "path": "/home/u/.dsh/skills/git-workflow/SKILL.md", "source": "user-dsh", "provider": "filesystem" }
  },

  "layout": { "code-review": { "x": 120, "y": 40 } },

  "snapshot": {
    "revision": 11,
    "runtime": ["code-review", "git-workflow"],
    "excluded": []
  }
}
```

**字段说明**

| 字段 | 作用 |
|---|---|
| `id` | **UUID**，存储键与文件名（D18）。永不从名称派生，因此重命名不移动文件、不使会话绑定失效 |
| `name` | 显示名，**中英文与 emoji 均可**（D19）；1–64 字符，去首尾空白，无控制字符，**大小写不敏感地全局唯一** |
| `members` | 图的根集合；保存时被补齐为整个 `requires` 闭包（D20） |
| `edges` | 技能 → 技能的 `requires` 边；`why` 为人可读的必要性说明 |
| `conflicts` | 对称互斥对，不入 `edges`（有向边表达对称关系会产生歧义） |
| `anchors` | 技能在保存时的来源锚点（`path` / `source` / `provider`）。**仅作证据，永不参与解析**（D23）；用途是**确认技能是否缺失**（D24）与发现重装漂移；导出时剥离 |
| `layout` | 仅保存用户手动拖过的节点坐标；缺省走自动布局 |
| `snapshot` | 保存时冻结的运行时集合（红点已扣除），用于漂移检测与"我当初是什么样" |

**刻意不存的**

- **不存技能节点表**：节点集合 = `members ∪ edges 端点 ∪ conflicts 端点`，推导即可，避免两处数据打架。
- **不冗余技能描述**：从仓库实时取，避免漂移。
- **不存角色节点**：文件本身即根，省掉 `role:` 前缀与撞名问题。

### 3.2 索引与运行时状态

```
$DSH_HOME/roles/
├── 3f2a6c1e-….json          # 角色图（D12：一角色一文件；文件名即 UUID）
├── 9b4d4e21-….json
├── bindings.json            # sessionId → roleId（运行时状态）
└── graph-log.jsonl          # 变更审计（agent 与人共用）
```

`bindings.json` 与图分开：设计状态与运行时状态混存会导致每次切角色都重写图。

### 3.3 存储要求

- **按角色原子写**（同目录临时文件 + rename），UTF-8 无 BOM。
- **revision 是每个角色本地的**：两个 agent 改不同角色互不冲突；冲突返回 409。
- **启动时全量载入内存**：`agent/created` 的处理器必须同步完成应用，不能在事件里读盘。
- 读损坏 → 备份 `*.corrupt-<ts>` → 跳过该角色，不阻塞启动。
- 变更追加 `graph-log.jsonl`（谁改的、改了什么、何时）。

### 3.4 一角色一图的代价与对冲

**代价**：同一条边若出现在多个角色里，会存多份；改一处忘另一处是真实风险。

**对冲（均不引入跨角色存储耦合）**

1. **复制角色作为主要创建方式**：新角色从既有角色复制，边一并带过来。
2. **校验面板检测重复边**：同一条边出现在 N 个角色 → 提示"建议提取为模板"，只提示不自动改。
3. **fan-in 为派生视图**：扫所有角色文件算出"该技能被几个角色引用"，只读、不落盘。

> 跨角色的信息仍然可查，但没有任何跨角色的存储耦合——这是本设计刻意的边界。

### 3.5 技能是怎么被"安装"和记录的

DSH **没有技能安装记录**：没有 manifest、没有版本、没有安装时间、没有来源 URL。所谓安装，只是把目录放进某个被扫描的位置，或由插件在运行时注册。

文件系统 provider 扫描六个根，`rank` 越小优先级越高，同名取最小者：

| rank | source | 路径 |
|---|---|---|
| 100 | `project-dsh` | `<项目根>/.dsh/skills` |
| 200 | `project-agents` | `<项目根>/.agents/skills` |
| 300 | `custom` | 配置项 `customSkillDirs` |
| 400 | `user-dsh` | `~/.dsh/skills`（跳过 `.system`） |
| 500 | `user-agents` | `~/.agents/skills` |
| — | `bundled` | `$DSH_BUNDLED_SKILL_DIR`，随插件安装 |

每个根下扫子目录（含 `SKILL.md`）或扁平 `.md` 文件，解析 frontmatter；`name` 或 `description` 缺失即丢弃并打警告。另有两条不经过文件系统的来源：`ctx.skills.registerProvider()`（插件自定义来源，`bundled` 即如此）与 `ctx.skills.register()`（运行时注册，来源标记 `runtime`）。

**对锚点的直接后果**：能证明"这个技能当时在哪"的只有保存时的快照，没有数据库可回查。因此锚点只能是**证据**，不能是**引用**；`source` 必须一起记，因为同名技能在不同根下是否随项目走、换机器是否还在，完全不同。

---

## 4. 依赖语义与校验

### 4.1 边的类型

| 边 | 方向 | 语义 | 数量 |
|---|---|---|---|
| `members` | 角色 → 技能（隐式） | 该技能被纳入 | 不限 |
| `requires` | 技能 → 技能 | 前者假设后者的内容可用 | **进出均不限** |

边的约束只有三条：

1. **同一个 `(from, to)` 只能有一条**——"a 需要 b"说两遍没有意义，`link` 再次连同一对是替换而非叠加；
2. **禁止自环**（`a → a`）；
3. **禁止成环**（保存时拒绝，并给出完整环路）。

扇入与扇出都不设上限：一个技能可以被任意多个技能依赖，也可以依赖任意多个技能。代价体现在 UI 上——一个红点可能带走一大片，所以"影响计数"是必须的，而不是可选的。

### 4.2 为什么废除分层模型

原方案（契约 / 方法 / 领域 / 任务四层 + "依赖只能向下"）被废止：

1. 它是**作者指派的分类**，不是描述出来的结构；同时属于方法与领域的技能无处安放。
2. 它**禁止了合法边**：`design-system → typography-scale` 是同域硬依赖，很常见，规则逼作者编造上层。
3. 层是全局的，但位置是**相对于根**的：同一技能在角色 A 是第 2 跳、在角色 B 是第 4 跳。
4. 链路一深（5–6 跳），层成为对图的一次错误二次编码；图改了层没改，比没有层更糟。

保留唯一有价值的部分：**拓扑偏序**，但它是**推导的、按角色计算的、只用于布局与排序**。

```
topoLevel(s, R) = 1 + max(topoLevel(d, R))   over d ∈ requires(s) ∩ R
                    0                              if requires(s) ∩ R = ∅
```

### 4.3 校验规则（服务端强制，不信任 agent）

| 规则 | 处置 |
|---|---|
| `requires` 成环 | 拒绝写入 |
| 成员的 `requires` 闭包中有未纳入的节点 | **保存时把整个闭包补进 `members`**（D20）；其中仓库解析不到的节点保留为红点，其下游转灰 |
| 集合内存在 `conflicts` 对 | 拒绝保存 |
| **`requires` 传递闭包引入 `conflicts` 对** | 拒绝保存（深链路特有，必须单测） |
| 引用不存在的技能 | 允许（红点来源），写入结果带警告 |
| 同一条边在其他角色中也存在 | 仅警告（§3.4） |
| `why` 缺失 | agent 建边 → 拒绝；人手建边 → 允许 |
| 锚点漂移（技能被重装到别的路径 / 换了来源） | 仅警告，不阻断（D23） |

---

## 5. 运行时

### 5.1 集合解析

```
作用域 S    = members 的 requires 传递闭包（保存时即等于 members，D20）
红集合 R    = S 中在仓库解析不到的节点
灰集合 G    = S \ R 中，可沿 requires 反向走到 R 的节点（传递）
运行时集合 H = S \ (R ∪ G)          ← 会话实际可见（D21：不做部分可用）
```

`H` 在保存角色时冻结进 `snapshot`；运行时以 `H` 为准。

### 5.2 应用机制

| 角色面 | API | 生效时机 |
|---|---|---|
| persona.prefix | `agentCtx.systemPrompt.section({ name: PERSONA_PREFIX_SECTION, order: systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text })` | 下次 prompt 组装 |
| persona.suffix | 同上（SUFFIX 段落） | 同上 |
| skills | 对 `补集(H)` 中每个技能注册同名影子，`invocation: { modelInvocable: false, userInvocable: false }` | 下次技能目录组装 |
| runtime context | `agentCtx.systemPrompt.suppressRuntimeContext()` | 下次组装 |

全部返回 Cordis disposer，挂在 `agent.ctx` 上，会话销毁自动 unwind。

**影子注册硬要求**：注册前必须取该技能的**完整原定义**（含 `content`），只覆写 `invocation`。否则 `userInvocable` 场景会加载出空正文。写成单测。

### 5.3 连坐（D21）

灰不是"提示"，是"事实上缺失"：一个技能的依赖链断了，它的指令就失去了前提，继续留在运行时集合里只会让模型读到一份无法执行的说明书。因此灰**与红一样被排除**，且沿 `requires` 反向传递——依赖灰的节点同样不可用。

这是刻意的保守选择：**宁可少给，不可给错**。

代价必须由 UI 承担：一个红点可能带走整条上游链，所以画布必须同时给出"影响 N 项"和每个灰点的来源路径，否则用户只会看到一个小红点、却不知道半个角色已经停用。

**不变式**：灰只能由红派生。没有红点时必须不存在灰点，代码中以断言守住——它防的是增量计算或缓存重构时让灰意外独立存在。

### 5.4 漂移自愈

订阅 `skills/change` 事件（`dsh-skill/src/index.ts:296`）：

1. 重算仓库视图与各已绑定角色的运行时集合；
2. 与当前 generation 的集合比较；
3. 不同 → 对该会话重建 generation（dispose + install）。

效果：技能装回来后红点自动消失、灰点随之消失；新装技能自动被压制。这同时解决了"切换后新装技能露出来"的竞态。

### 5.5 红色的成因（锚点的真正用途）

**状态只有一种：名字解析不到即红。** 锚点不改变颜色，它只解释"为什么红、去哪修"——诊断信息不是状态。

| 锚点文件在 | 成因说明 | 处置 |
|---|---|---|
| ❌ | 确认缺失 | 重新安装该技能 |
| ✅ | 文件还在但未被加载 | 检查技能根配置或 frontmatter（provider 丢弃了它） |
| 无锚点 | 未确认 | 虚拟技能或旧数据，不做猜测 |

名称查得到、只是路径或来源变了 → **不是缺失**，只报漂移警告。这也是"锚点不参与解析"的原因：拿路径判定会把重装误报成缺失。

判定顺序写死为：**先名称，后锚点**。名称解析成功就绝不算缺失。

### 5.6 缺失的可观测性（不进上下文）

- 会话头 chip 显示 `角色名 · 排除 N 项（红 a / 灰 b）`，点开列出每一项、其来源路径与缺失判定（missing / unloaded / unconfirmed）；
- 每次会话启动向 runtime log 写一条"可见集合 + 排除清单"记录；
- **不向模型注入任何提示**——D7 要求模型不感知依赖。

### 5.7 生命周期

| 时机 | 行为 |
|---|---|
| 新建会话选角色 | 客户端写空白会话的 binding（此时无 agent） |
| `agent/created` | 同步读内存 binding → 用 `snapshot.runtime` 建 generation |
| 会话恢复 | binding 仍在 → 同上 |
| fork | 继承父会话角色 |
| 子代理 | 默认继承父会话角色；父会话通过 `role_spawn` 显式指定（§5.8） |
| 会话删除 | GC 清理 binding |
| 角色删除 | 仅 UI 可执行（D10）；删文件即删图；绑定的会话回落为原生态 |

### 5.8 子代理角色解析

原生 `SubagentStartRequest` 没有 setup 钩子或 metadata 字段（`dsh-subagent/src/types.ts:144-191`），因此父会话无法通过原生 `subagent` 工具传参指定角色。解析规则：

1. **默认继承**：`agent/created` 时读 `header.parentSession`，子代理取父会话当时的角色快照。原生 `subagent` / `subagent-fork` 走这条。
2. **显式指定**：走本插件的 `role_spawn` 工具（§6.4）。
3. **`agent-team` 的并行建队**不走 `role_spawn`，成员继承父会话角色；需覆盖时只能在成员 prompt 中要求其自行切换。

子代理的角色是**快照**：父会话后续切换不影响已创建的子代理。

---

## 6. Agent 操作面

### 6.1 单一工具

```ts
role_graph({
  action: 'help' | 'list' | 'show' | 'plan' | 'create'
        | 'set_name' | 'set_persona' | 'add_members' | 'remove_members'
        | 'link' | 'unlink' | 'duplicate',
  role?: string,
  name?: string,
  persona?: string,
  add?: string[],
  remove?: string[],
  from?: string, to?: string,
  why?: string,
  dryRun?: boolean,
})
```

只给一个工具、用 `action` 分派：每多一个工具就多一份 schema 常驻上下文。描述压到三行以内，完整语义走 `action='help'`（同 `dsh-agents` 既有做法）。

**工具面不包含 `remove`**（D10）：删除角色只走 UI，避免一次误调用毁掉整套编排。

### 6.2 动作语义

| action | 说明 |
|---|---|
| `list` | 所有角色 + 成员数 / 运行时数 / 缺失数（红）/ 受阻数（灰） |
| `show` | 单个角色的完整子图：成员、闭包、拓扑层级、红点与灰点清单（含灰点的来源边）、**边上的 `why`**（D16） |
| `plan` | **只算不写**：给定技能集合返回闭包、冲突、缺失、环、token 估算 |
| `create` | 建角色（含空图） |
| `set_name` / `set_persona` | 改名称或人设（互不干扰，各自独立生效） |
| `add_members` / `remove_members` | **增量**维护成员（D15）：不需要先读现状，一次调用完成 |
| `link` / `unlink` | 加删 `requires` 边；agent 建边**必须**带 `why`（≤80 字） |
| `duplicate` | 复制一个角色连同整张图（§3.4 的主要创建方式） |
| `export` / `import` | （M5）导出 / 导入单角色图；默认 JSON，可指定 `yaml`；导出时剥离 `anchors`（D23） |

**为什么是增量而非整体替换**：整体替换要求 agent 先读当前成员、算差集、再提交——多一次往返，还容易抄错；增量原语不需要知道现状，误操作面也更小。D15 明确**不设"只增不减"限制**，那只会把工作转嫁给人。

`plan` 是最重要的一步：agent 很容易给出"看起来合理"的编排，`plan` 让它先看到闭包规模与冲突再落笔。

并发用 `revision` 乐观锁：冲突时返回当前状态，agent 一次重试即可，不引入额外人工步骤。

### 6.3 `role_spawn`

```ts
role_spawn({ role: string, prompt: string, name?: string })
```

为子代理指定角色。实现依赖一个前提：**同一 agent 的工具调用是串行的**，因此下述三步在一个调用内完成时无竞态——

1. 以父会话为键登记一次性 override；
2. `await ctx.subagents.spawn(...)`；
3. 立即清除 override。

不同父会话键不同，互不影响。原生 `subagent` / `subagent-fork` 仍走默认继承，两条路并存不冲突。

**覆盖不到的**：`agent-team` 的并行建队不走此工具，成员继承父会话角色（§5.8）。

### 6.4 感知视角

工具读仓库时必须取**两层并集**（真实宿主验证后修正）：

1. **全局层**：`ctx.skills.list({ cwd })` 不传 `scope`。这一层保证角色自身的排除不会让技能在编排视图里消失，否则会死锁——会话 A 被角色限制后，无法为角色 B 编排它看不见的技能。
2. **当前 agent 作用域**：`ctx.skills.list({ cwd, scope: agent })`。预设会挂载自己的技能 provider，这类技能**只存在于作用域层**；只读全局层会把它们误判成缺失。

合并规则：**同名以全局层为准**。否则一个 modelInvocable=false 的影子会把真实技能盖掉，制造假红。

`<available_skills>` 目录仍只显示当前会话可见部分，两者互不干扰。

---

## 7. UI

### 7.1 结构：左列表 + 单角色画布

- 左侧：角色列表（图标 / 名称 / 运行时数 / 缺失角标），一次只激活一个。
- 右侧：该角色的 DAG 画布。**不做多角色合并的大图**（D12）。
- 顶部：角色名、revision、保存状态、校验结果摘要。

### 7.2 观测性（读）

| 元素 | 解决的问题 |
|---|---|
| 三种节点状态（实心 / 红 / 空心）+ 悬停原因 | 红必须说明为什么（不存在 / frontmatter 损坏 / 被压制） |
| 灰点标记 + 影响计数 | 一次缺失会带走多少上游技能，以及每个灰点的来源路径 |
| 闭包规模与 token 估算（画布角标） | 这个角色实际会带多少技能进目录 |
| 引用路径（悬停任意被带入节点） | `build-deck → design-system → typography-scale`，深链里唯一能解释"你为什么在这"的东西 |
| 未编排托盘 | 仓库有、本图没有的技能，防"装了忘了用" |
| 漂移视图 | `snapshot` vs 仓库当前：谁被删、谁新增了依赖 |
| 跨角色引用计数（派生） | 改这个技能影响几个角色 —— "敢不敢动"的依据 |
| 校验面板 | 环、冲突、缺失、重复边，逐条带修复建议 |
| 变更日志 | agent 与人共用，可追溯 |

### 7.3 操作性（写）

| 元素 | 说明 |
|---|---|
| 拖拽连线 | 从节点边缘拉出边；**连线瞬间判环并拒绝**，不等保存 |
| 分层自动布局 | 按 `topoLevel` 分层，尽量减少交叉；手动拖动的坐标写入 `layout` |
| 框选 / 多选 / 批量连线 | 一次把多个技能连到根 |
| 自动补齐 / 清理不可达 | 纳入时拉入 `requires` 闭包；清理本图不可达节点 |
| 撤销 / 重做 | 画图没有撤销不可用 |
| 复制角色 | 连同整张图复制（§3.4） |
| 右键菜单 | 看正文、定位文件、复制路径、"只保留这一支" |
| 搜索定位 | 技能上百时搜索即定位并高亮 |
| 缩放平移 | 图会很大 |

**交互约定**：根 → 成员的 `include` 画实线，技能 → 技能的 `requires` 画虚线。否则用户分不清"我选的"和"被拉进来的"。

---

## 8. 与原生 DSH 的干涉面

### 8.1 总账

| 我们做什么 | 类型 | 改原生？ |
|---|---|---|
| 注册 `conversation.hero.options`（新建会话角色选择） | client slot（list，replaceRisk none） | 否 |
| 注册 `conversation.session.header.actions`（切换 + 缺失 chip） | client slot（list） | 否 |
| 注册 `sidebar.panellist`（编排工作台） | client slot（list） | 否 |
| `ctx.skills.list / get / register` | 宿主服务 | 否 |
| `skills/change`、`agent/created` | 宿主事件 | 否 |
| `agentCtx.systemPrompt.section()` / `suppressRuntimeContext()` | 宿主服务 | 否 |
| `ctx.tools.register`（role_graph） | 宿主服务 | 否 |
| 自己的 HTTP 路由 + 自己的数据文件 | — | 否 |

**不做的**：不 import 原生包运行时代码（只 `import type`）、不替换任何槽位、不 monkey-patch、不 fork、不改 profile 的 patch 结构。

### 8.2 禁用槽位

| 槽位 | 原因 |
|---|---|
| `conversation.hero.agentPreset` | `kind: single`，`replaceRisk: shadows-shipped-ui`，会顶掉原生模式选择器 |

只注册 `list` 类槽位，且使用自有 `id`。

### 8.3 风险与缓解

稳定性评级为判断，非官方承诺。

| 接入点 | 稳定性 | 失效症状 | 缓解 |
|---|---|---|---|
| `ctx.skills.*` | 高 | 角色完全不生效 | 启动探测；缺失则禁用功能并显示诊断 |
| `skills/change` / `agent/created` | 高 | 漂移不自愈 / 绑定不恢复 | 探测；退化为仅手动切换 |
| 三个 client slot | 中 | 对应控件消失 | 特性探测 + 分级降级 |
| `isModelInvocable` 语义 | 高 | 技能不隐藏 | 单测钉住目录条目数与 `snapshot` 结果 |

防护：声明 `engines.dsh` 不设上限；加载时逐项能力探测并分级降级；提供 `probe` 冒烟脚本；影子语义写成断言。

### 8.4 技能注入的两层（背景事实）

- **目录层**：`agent/pre-step` 每步取 `ctx.skills.snapshot({ scope: agent })` → `.filter(isModelInvocable)` → 仅在 digest 变化时插入一条 user 消息（`<system-reminder>` + `<available_skills>`）。内容只有 name + 截断 description。
- **正文层**：从不预注入；模型调 `skill(name)` 时才返回 `<skill_content>`。

由此：**角色收窄省的是目录描述文本，不是正文**；历史中的旧目录消息只被声明作废、不被删除，切换后会出现新旧两份短暂并存，直到压缩。

### 8.5 两个 flag 分别把守两个面

| 面 | 判据 | 位置 |
|---|---|---|
| 模型目录 | `isModelInvocable` | `dsh-tool-skill/src/index.ts:229` |
| `skill` 工具按名加载 | `isModelInvocable` | 同文件 `:142,149` |
| 用户 `/` 菜单 + 客户端技能列表 | `isUserInvocable` | `dsh-api-session-controller/src/skill-catalog.ts:78` |
| 用户显式调用 | `isUserInvocable` | `dsh-tool-skill/src/index.ts:199` |

**影子必须两个都置 false**，否则留下"模型看不到、`/` 菜单还在"的漏口。

### 8.6 与其他插件

| 插件 | 关系 |
|---|---|
| `dsh-persona` | 注册同名 section 会覆盖 preset 人设，属预期；不声明 `suffix` 时全局 suffix 被 shadow，UI 需提示 |
| `dsh-plugin-context-trim` | 机制相同（影子 + section + restrict），同时使用会操作同一批条目，需实测 |
| `dsh-capability-menu` | 正交：它管"怎么被发现"，本插件管"谁能看见"；叠加后 `meta_search` 仍可能搜到被压制的技能 |
| Kabutack | 全局切换是上限，角色在其之上再收窄 |
| agent-roles / dsh-agents | 概念重叠但层面不同：它们是子会话模板，本插件是主会话自己的角色 |

---

## 9. 里程碑

agent 路径先于 UI：它不需要前端即可满足"用户只提需求"的主场景。

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M1** | 单角色文件存储 + DAG 校验 + `role_graph` 工具（含 `plan`） | ✅ 已落地（68 条测试）；**尚未在真实 profile 加载** |
| **M2** | 运行时应用（角色 → 运行时集合 → 影子 + persona）+ `bind` / `unbind` | ✅ 影子、persona、绑定、漂移重建已实现；`role_spawn` 待做 |
| **M3** | 只读图 UI（观测性） | 红 / 灰 / 空心状态、灰点的直接来源边、漂移视图正确 |
| **M4** | 可编辑图 UI（操作性） | 拖拽连线、瞬间判环、撤销重做可用 |
| **M5** | 并发（revision 冲突）+ 审计 + 导出导入 | agent 与 UI 同时改同一角色不丢数据 |

估量：M1 ~450 行，M2 ~450 行，M3 ~450 行，M4 ~500 行，M5 ~200 行。

---

## 10. 待确认

1. **`role_spawn` 的覆盖面**：`agent-team` 并行建队不走此工具（§5.8），成员只能继承父角色。当前决定先不做单独路径（D17），需确认这个限制可接受。

---

## 11. 附：本文引用的本机事实

| 结论 | 出处 |
|---|---|
| `conversation.hero.options` 为 list、session 作用域、replaceRisk none，描述为"新会话行、工作区与预设之后" | `dsh-cordis-client-runner/src/client/slot-catalog.ts:1189-1246` |
| `conversation.hero.agentPreset` 为 single、`shadows-shipped-ui` | 同文件 `:1063-1101` |
| 新子槽只能由渲染它的组件声明；single 与已占用 keyed cell 是替换点 | `docs/subsystems/slots.md:226,230` |
| `<available_skills>` 按 `scope: agent` 现算并 `filter(isModelInvocable)`；digest 不变则不注入 | `dsh-tool-skill/src/index.ts:217-255` |
| `skill` 工具按名加载校验 `isModelInvocable` | 同文件 `:142,149` |
| `ctx.skills.register()` 写入调用上下文层；跨层近层覆盖远层 | `dsh-skill/src/index.ts:439-460, 551-565` |
| `SkillSummary` 不含 metadata（`toSummary` 丢弃），取 metadata 需 `get()` | `dsh-skill/src/index.ts:769-781` |
| `skills/change` 事件存在 | `dsh-skill/src/index.ts:296` |
| frontmatter 只认 name/description/whenToUse/invocation/metadata；顶层未知键静默忽略 | `dsh-skill-filesystem/src/index.ts:1014-1056, 229` |
| `ctx.skills.list()` 不传 `scope` 时只读全局层 | `dsh-skill/src/index.ts` `SkillViewOptions` |
| `suppressRuntimeContext()` 返回 disposer | `dsh-system-prompt/src/index.ts:537` |
| `agent.ctx` 注册仅作用于该 agent 并随 disposal 回收 | `dsh-agent/README.md` |

---

## 12. 待补设计（写代码前需定）

以下四项在正文中没有结论，M1/M2 前必须补齐。

### 12.1 客户端与宿主之间的 HTTP 路由

client 半需要读图、读仓库、写图，但正文未定义接口。补齐时须同时给出安全基线：只接受回环来源、`remoteAddress` 为空一律拒绝、校验 `Host`、校验 `Origin` 同源、请求体上限、角色 id 只允许 `[a-z0-9-]+`。

### 12.2 角色 id 与文件名规则（已定）

已定（D18/D19）：id 为 UUID（版本无关的 8-4-4-4-12 十六进制），`roles/<uuid>.json`；`name` 为自由文本，中英文与 emoji 均可，大小写不敏感唯一。UUID 天然规避 Windows 保留名、结尾点号、大小写敏感与中文转写问题，因此无需额外字符集规则。

### 12.3 卸载时的数据保留

按仓库发布契约，卸载插件不得默认删除仍可能有价值的用户数据。需明确：卸载是否保留 `$DSH_HOME/roles/`、重新安装是否复用、手工清理前需要什么确认。

### 12.4 `role_spawn` 与宿主委派深度上限的关系

**两个"深度"无关，必须先分清：**

| 名称 | 含义 | 所属 |
|---|---|---|
| 委派深度（delegation depth） | **代理套代理**的层级：顶层代理为 0，其子代理为 1，孙代理为 2 | 宿主 `dsh-subagent` |
| `topoLevel`（拓扑层级） | 角色图里 `requires` 边的跳数，用于布局与加载排序 | 本插件，纯推导，不影响运行时 |

`dsh-subagent` 的 `Config.maxDepth`（schema 默认 **1**）是前者的绝对上限：子代理深度 = 父深度 + 1，超过即抛 `SubagentDepthError`。默认值 1 意味着**主代理能开子代理，子代理不能再往下开**；设为 0 则任何代理都无法派生。

`role_spawn` 走宿主 spawn，因此受这条限制。工具必须把 `SubagentDepthError` 翻译成可执行的提示（"当前委派深度上限为 N，本代理深度已到 N，无法继续派生；如需多层委派请调整宿主的 `subagent` 配置"），而不是把底层异常原样抛给模型。**不得**绕过该上限。

正文中 `topoLevel` 刻意不叫 `depth`，就是为了避免与这个宿主概念在代码与文档里撞名。
---

## 13. 真实宿主验证记录

**2026-11-20，DSH 0.2.2-rc.5，Windows，`link:` 安装，`plugin_manager install_bundle` 激活。**

已验证：插件加载（`role_graph` 进入工具目录）、`help` / `list` / `show` / `plan` / `create` / `link`、闭包自动补齐、`why` 落盘、锚点采集、revision 递增、`MISSING_WHY` 错误映射、按显示名解析、文件落在 `~/.dsh/roles/<uuid>.json` 且格式化正确。

发现并修复两个只有真机才能暴露的问题：

1. **预设作用域技能被误判为缺失**。`dsh-doc` 由预设包通过 `customSkillDirs` 挂载，只存在于 agent 作用域层；只读全局层会让它变红。修复：两层并集（§6.4）。
2. **`topoLevels` 在无边时返回空表**。只遍历了有出边的节点，成员节点不在结果里。修复：遍历闭包。

另一条运维结论：**改动已加载插件的代码后，`disable` + `enable` 可以让宿主重新导入**（不必重启整个 DSH）；仅改数据或文档则无需任何操作。

### M2 运行时验证（同日）

用一个 `members: []` 的临时角色绑定**当前会话**，宿主随即发出替换目录消息、`<available_skills>` 为空——7 个技能全部被影子覆盖，`shadowed: 7`。随后 `unbind`，宿主再次发出替换目录，7 个技能全部恢复。**两个方向都由宿主自己的目录消息证实**，不是插件自述。

同一轮发现并修复的第三个问题：绑定写到了 `~/.dsh/bindings.json`，而设计是 `~/.dsh/roles/bindings.json`（`dirname(rolesDir)` 多退了一层）。修复后路径抽成 `bindingsFileFor()` 并加了测试。

锚点的三种真实形态也在同一轮采集到：

| 技能 | source | provider | path |
|---|---|---|---|
| `office` / `office-docx` … | `bundled` | `dsh-office` | 无（provider 虚拟技能） |
| `dsh-doc` | `custom` | `filesystem` | 有（预设通过 `customSkillDirs` 挂载） |
| `ssh-operator` | `bundled` | `runtime` | 有（插件运行时注册） |

这三种形态决定了锚点必须是 `{path?, source?, provider?}` 三元组：任何单一字段都会在某一类技能上失效。

**尚未在真实宿主验证**：新会话的 `agent/created` 自动安装（本轮是会话内 `bind` 触发）。代码路径与 `bind` 共用同一个 `install()`，但事件时序只在新建会话时才会走到。
---

## 14. 运行时的实现细节（M2）

### 14.1 安装顺序

`agent/created` 经 `ctx.serial` 派发并 **await**（`dsh-agent/src/runtime-types.ts:291`），所以异步安装是安全的，不会与首个 step 抢时序——早期"必须同步"的约束据此取消。

安装一次的顺序固定为：

1. dispose 旧 generation（必须在前，否则取定义时拿到的是自己的影子）；
2. 读仓库视图（全局 ∪ agent 作用域）→ 计算运行时集合；
3. 只对"仓库有、角色不暴露"的技能逐个取完整定义（含正文）；
4. 注册影子（两个 invocation flag 都关）+ persona section；
5. 记入 generation 表。

影子必须携带原定义正文：虽然两个 flag 都关后任何加载路径都会被拒，但空正文一旦被绕过就会静默产出空指令。

### 14.2 注册的作用域

影子与 persona 必须注册在 **agent 作用域**（`agent.ctx.get('skills')` / `agent.ctx.get('systemPrompt')`），不是插件的 host 作用域。注册在 host 会把技能从所有会话里隐藏——这是最容易犯且最难察觉的错误。

### 14.3 绑定

`$DSH_HOME/roles/bindings.json`：

```jsonc
{ "schema": 1, "bindings": { "sess_abc": { "roleId": "<uuid>", "boundAt": "..." } } }
```

与角色图分开存放，切角色不重写任何角色文件。损坏时退化为空绑定而不是抛错——丢绑定只会让会话回到原生行为，不会损坏角色。

### 14.4 漂移重建

订阅 `skills/change`，**防抖 250ms** 后对每个有 generation 的会话重算并重装。防抖是必需的：一次 provider 刷新会连发多个事件，不防抖会把安装过程打成风暴。

---
### M2 生命周期验证与一次崩溃复盘（同日）

**这次崩溃把整个 DSH 进程带走了**，原因值得记下来。

`skills/change` 用了 250ms 防抖定时器。插件卸载时，释放影子会再次触发 `skills/change`，于是又排了一个定时器；插件注销后它照常触发，回调里 `ctx.agents.get(...)` 抛出 `cannot get required service "agents" in inactive context`。定时器回调里的异常没有人接，直接升级为 `dsh: fatal load failure`。

根因不是"用了定时器"，而是**定时器不受 Cordis 生命周期管理，而回调里访问了受生命周期约束的服务**。修法是三道：

1. 插件级 `active` 标志，卸载时先置 false；
2. 定时器回调与事件回调入口都检查该标志；
3. 回调整体包在 try/catch 里——宁可丢掉一次重建，也不能让异常逃逸到事件循环。

另一处加固：`logger` 在 apply 时捕获成局部变量。context 失效后连 `ctx.logger` 的**访问本身**都可能抛。

修复后重放同一场景：带 7 个影子禁用插件 → 不崩、目录立即恢复；重新启用 → 绑定被自动恢复、目录再次清空；解绑 → 恢复。三步全部由宿主的目录消息证实。

**给后续插件作者的两条硬规则**：任何脱离 effect/handler 生命周期的异步工作都必须自带存活检查；任何可能逃逸到事件循环的异常都必须就地吞掉并记录。
### 14.5 生命周期加固（`scheduler.js`）

崩溃后的修法被抽成独立模块，因为**写在 `index.js` 里的防御逻辑无法被测试，等于没有**。

`scheduler.js` 提供一个带存活检查的防抖任务：

- 触发时检查所有者存活，不存活则连定时器都不排；
- 回调触发时再检查一次（所有者可能在排队期间卸载）；
- 回调内的同步异常与 Promise 拒绝都交给 `onError`，绝不逃逸到事件循环；
- 用**代际令牌**作废过期回调——`clearTimeout` 只是对定时器的承诺，对已经排进事件循环的回调不再是保证。

对应测试 9 条，覆盖：突发只排一次、卸载后不排、排队期间卸载不执行、同步抛错、异步拒绝、取消后回调空转、重复取消、非法参数。

`runtime.js` 另有 3 条防御性测试：`dispose` 幂等、单个 disposer 抛错不影响其余、单个技能注册失败不中断其他影子。
### M2 收尾：子代理角色（`role_spawn`）

原生 `SubagentStartRequest` 没有可传插件数据的字段，因此"父会话给子代理指定角色"只能靠**一次性登记**：

1. 以父会话为键登记 override；
2. `startActivation({ provider: 'spawn', ... })`；
3. 无论成功失败都清除。

三步在同一个工具调用内完成，而同一个 agent 的工具调用是串行的，因此不存在竞态；键是父会话，不同父会话之间也不会互相消费。

`agent/created` 的角色解析顺序（`resolveCreatedRole`，纯函数）：

| 顺序 | 来源 | 说明 |
|---|---|---|
| 1 | `override` | `role_spawn` 显式指定 |
| 2 | `inherit` | 父会话的绑定 |
| 3 | `own` | 子会话自身的绑定（预绑定或恢复） |
| 4 | `none` | 原生态 |

候选角色**加载失败则跳过**而不是中止——override 指向已删除的角色时，必须继续回退到继承，否则一个失效的 override 会让子代理完全失去角色。

解析成功后把绑定写到子会话，所以插件重载或子会话续跑时不必依赖父会话仍在。

**真机验证**：`role_spawn` 派生 `agent-1`，子会话 `9bd96f9c-…` 的绑定出现在 `roles/bindings.json`，子代理回 `OK`。父会话自身未被绑定。

**未真机验证**：`inherit` 分支（需先给父会话绑定，再用原生 `subagent` 派生）。该分支由 `resolveCreatedRole` 的 8 条单测覆盖。
---

## 15. M3：只读页面

### 15.1 入口位置

- `sidebar.panellist`，`id = skill-loom`，`order = 5`。
- 既有 order：插件 `0`、自动化任务 `10`；`5` 正好落在两者之间，也就是"自动化任务与更多之间"。
- 同一 `id` 同时作为 `main` 的 key —— 侧栏条目 id 就是中央面板的键，两者必须一致。

### 15.2 只读 HTTP 接口

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/plugins/skill-loom/roles` | 角色摘要数组 + 全量技能目录 |
| GET | `/plugins/skill-loom/roles/<uuid>` | 单个角色 + `plan` + `health` + `missing` 解释 |

`WebResourceRoute`（`kind: 'prefix'`，Fetch 风格 `resource`），只接受 GET/HEAD，其余 405；前缀之外 404；异常转 500 而不是未处理拒绝。

**视角**：页面是 root 作用域，没有 session 绑定，因此目录取"全局层 ∪ 所有活跃 agent 的作用域"。这是编排视角应有的超集——不能因为某个 HTTP 请求没有 agent，就把预设挂载的技能报成缺失。

实测返回 7 个技能，其中 `dsh-doc` 的 `source` 是 `custom`，证明并集在 HTTP 侧同样生效。

### 15.3 客户端

- 无构建步骤：`client.js` 直接是 `window.__ModuleLoader__.load({ id, factory })` 格式。
- `dsh.client = { platform: 'web', immediately: true, inject: ['@deepseek-ai/dsh-client-ui-layout'] }`。
- 页面：左列角色、右侧详情（技能三态点 + 锚点路径、依赖边与 `why`、校验清单）。
- 文字暂为中文硬编码，本地化留到 M3 收尾。

**验证状态**：✅ 已确认。侧栏入口出现在「插件」与「自动化任务」之间；页面正确渲染角色、技能三态、锚点路径与计数。
### 15.4 上线时踩到的三个坑

**1. `exports["./client"]` 必须指向真实文件。**
客户端 bundle 由 `exports` 解析；写错路径不会报错，只是宿主找不到 bundle，页面上一片空白而侧栏也没有入口（或入口在但请求 404）。这是纯粹的低级错误，却要重启才能发现。

**2. 新增客户端模块必须重启宿主。**
插件管理器的 live 重载只处理**已注册 bundle 的重建**，不处理**新增**：客户端模块图在启动时构建（`window.__DSH_BOOT__`）。因此宿主代码改动 `disable + enable` 即可，客户端模块首次出现必须重启 `dsh web`。

**3. `/plugins/*` 是客户端模块的命名空间，不能占用。**
最初把只读接口放在 `/plugins/skill-loom`。运行中启用时能命中（我们注册得更晚但更具体），重启后 `client-modules` 先占住 `/plugins` 前缀，我们的路由被盖掉，页面直接 404。已迁到 `/skill-loom`。

**附带一条**：`webServer` 必须用 `ctx.inject(['webServer'], ...)` 等待，不能用 `ctx.get('webServer')`。启动阶段服务尚未就绪，`get` 返回 undefined，注册被静默跳过——运行中启用时却有值，所以这个错误只在重启后显现。
### 15.5 M3 验收

| 项 | 状态 |
|---|---|
| 侧栏入口位置（插件 0 / 本插件 5 / 自动化任务 10） | ✅ |
| 角色列表与计数 | ✅ |
| 技能三态与锚点路径 | ✅ |
| 依赖边与 `why` | ✅（示例角色无边，靠代码路径保证） |
| 只读接口 | ✅ 本机请求验证 |
| 页面渲染 | ✅ 用户确认 |

已知留待 M4 的前置问题：页面不会自动刷新，agent 改完角色后需要手动刷新。
---

## 16. M4a：成员增删

### 16.1 写通路

- `POST /skill-loom/roles/<id>/members`，body `{ action: 'add_members' | 'remove_members', add?/remove?, expectedRevision? }`。
- 只放行这两个动作；其余动作（`create`、`bind`、`link`…）仍只经 agent 工具，页面拿不到。
- 写请求校验 `Origin`：浏览器跨源会被拒；字面量 `null`（沙箱 iframe）也拒；无 `Origin` 的本机工具（curl、测试）放行。
- 请求体上限 64KB，超限在解析前就返回 413。
- 成功回 200；校验失败回 400 带 `code`；revision 不匹配回 **409 并附当前角色**，页面据此提示“刚被修改过”。

### 16.2 两个新坑

**1. `WebResourceRoute` 只回答 GET/HEAD。**
宿主的 resource 路由对 POST 直接回 `405 allow: GET, HEAD`，请求根本到不了处理函数。写路由必须用 `WebRoute.handler`（Node 风格 `req`/`res`）。适配器 `toNodeHandler` 把 Fetch 风格的 resource 包成 handler，两条路径共用同一套逻辑。

**2. 页面发起的写入没有 agent。**
`api` 的目录回调在 `agent === undefined` 时只读全局层，于是预设挂载的 `dsh-doc` 在保存时被判为缺失、锚点被丢弃。修复：目录并集抽成 `catalog.js` 的 `buildCatalog`，无 agent 时并集所有活跃 agent 的作用域；有 agent 时只并集它自己的。这是同一个 bug 的第三次出现（读路径、HTTP 读、写路径），因此这次直接抽成模块并加 6 条测试。
---

## 17. M4b：连线可视化与编辑

### 17.1 版面

上下分栏：

- **上半：编排图**。角色是根，位于最上方；技能按 `topoLevel` 向下分层（叶子在最下）。`include` 边虚线、`requires` 边实线，节点左侧色点表示三态。
- **下半：技能区**。左列是角色列表 + 可过滤的技能列表（标注是否已纳入），右列是选中技能的详情与连线编辑。

点节点或技能名即选中；右侧可增删它在本角色里的依赖。

### 17.2 布局规则

`y = (roleLevel - level) * ROW_H`，其中 `roleLevel = maxLevel + 1`，因此角色永远在最上、依赖永远在下方。同一层内水平居中，画布宽度按最宽一层计算。

这是纯静态布局：不做力学模拟（Zotero 那类），因为角色图是有向无环的层级结构，力学图反而会让"谁依赖谁"变得不可读。

### 17.3 写接口

新增 `POST /skill-loom/roles/<id>/edges`，body `{ action: 'link' | 'unlink', from, to, why?, expectedRevision? }`。

动作白名单按路由分离：成员路由只收 `add_members`/`remove_members`，边路由只收 `link`/`unlink`，互不越界。

### 17.4 人手建边不强制 `why`

D11 要求 agent 建边必须写理由，人不需要。此前 API 层把这条规则硬编码成"永远必填"，页面因此无法建边。现在由调用方声明 `source`：页面写 `human`，工具写 `agent`。

### 17.5 真机验证

`link` 写入成功（revision 5→6），`levels` 由全零变为 `office-docx: 1`，读接口与写接口一致。
