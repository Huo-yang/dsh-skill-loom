# dsh-skill-loom 架构设计

> 状态：**v1.6（设计阶段，M1 进行中：纯图逻辑已落地，25 条测试通过）**
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

---

## 4. 依赖语义与校验

### 4.1 边的类型

| 边 | 方向 | 语义 |
|---|---|---|
| `members` | 角色 → 技能（隐式） | 该技能被纳入 |
| `requires` | 技能 → 技能 | 前者假设后者的内容可用 |

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

### 5.5 缺失的可观测性（不进上下文）

- 会话头 chip 显示 `角色名 · 排除 N 项（红 a / 灰 b）`，点开列出每一项及其来源路径；
- 每次会话启动向 runtime log 写一条"可见集合 + 排除清单"记录；
- **不向模型注入任何提示**——D7 要求模型不感知依赖。

### 5.6 生命周期

| 时机 | 行为 |
|---|---|
| 新建会话选角色 | 客户端写空白会话的 binding（此时无 agent） |
| `agent/created` | 同步读内存 binding → 用 `snapshot.runtime` 建 generation |
| 会话恢复 | binding 仍在 → 同上 |
| fork | 继承父会话角色 |
| 子代理 | 默认继承父会话角色；父会话通过 `role_spawn` 显式指定（§5.7） |
| 会话删除 | GC 清理 binding |
| 角色删除 | 仅 UI 可执行（D10）；删文件即删图；绑定的会话回落为原生态 |

### 5.7 子代理角色解析

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
        | 'link' | 'unlink' | 'duplicate' | 'export' | 'import',
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
| `export` / `import` | 导出 / 导入单角色图；默认 JSON（无损、无需解析器），可指定 `yaml` 以便手工编辑与 code review |

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

**覆盖不到的**：`agent-team` 的并行建队不走此工具，成员继承父会话角色（§5.7）。

### 6.4 感知视角

工具读仓库时必须用**全局视角**：`ctx.skills.list({ cwd })` **不传 `scope`**，只读全局层。否则会死锁——会话 A 被角色限制后，无法为角色 B 编排它看不见的技能。

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
| **M1** | 单角色文件存储 + DAG 校验 + `role_graph` 工具（含 `plan`） | 对 agent 说"建个审阅角色"，它自行完成编排，`show` 结果可核对 |
| **M2** | 运行时应用（角色 → 运行时集合 → 影子 + persona）+ `role_spawn` | 会话 `<available_skills>` 条目数变化可核对；子代理角色可核对 |
| **M3** | 只读图 UI（观测性） | 红 / 灰 / 空心状态、灰点的直接来源边、漂移视图正确 |
| **M4** | 可编辑图 UI（操作性） | 拖拽连线、瞬间判环、撤销重做可用 |
| **M5** | 并发（revision 冲突）+ 审计 + 导出导入 | agent 与 UI 同时改同一角色不丢数据 |

估量：M1 ~450 行，M2 ~450 行，M3 ~450 行，M4 ~500 行，M5 ~200 行。

---

## 10. 待确认

1. **`role_spawn` 的覆盖面**：`agent-team` 并行建队不走此工具（§5.7），成员只能继承父角色。当前决定先不做单独路径（D17），需确认这个限制可接受。

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