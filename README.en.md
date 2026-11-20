<h1 align="center">dsh-skill-loom</h1>

<p align="center">Weave skills into roles: a dependency graph that decides which skills a session may see</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-orange" alt="Version 0.1.0" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/DSH-0.2.2--rc.5-blue" alt="DSH 0.2.2-rc.5" />
</p>

<p align="center"><a href="README.md">简体中文</a> | <strong>English</strong></p>

---

## The problem

DSH's skill catalog is process-wide: every session sees the same `<available_skills>`. With dozens of skills installed, each request carries all of their names and descriptions, which eats context and makes the model choose worse.

| Approach | Mechanism | Gap |
|---|---|---|
| Agent Preset | Pick a plugin subset when a session is created | Locked once the session starts |
| Skill managers | Group filtering, on-demand exposure, per-item trimming | No "role" as a whole |

`dsh-skill-loom`'s position: **skills depend on each other, and those dependencies should be drawn.** A role is the root of that graph, and a session narrows its usable skills by binding to a role.

## Features

- **A role is one dependency graph.** The role is the root, skills are nodes, `requires` are edges. One file per role; deleting a role deletes its whole graph.
- **Visual orchestration.** Top-down from the role; drag nodes to connect, drag skills in from the list, drag a node to the trash zone to remove it, drag a session onto the role node to bind.
- **Agent-operable.** `role_graph` creates roles, edits members and edges, and dry-runs; `role_spawn` runs a subagent under a chosen role.
- **Session-scoped.** Binding changes that session's skill catalog only.
- **Missing is visible.** A deleted or renamed skill turns red and its dependents gray, with diagnostics that say whether the file is gone or merely unloaded.

## Requirements

- DSH Web `0.2.2-rc.5` (verified against this version).
- Node.js 22+.
- Web profile only (client slots).

## Install

```powershell
dsh plugin --profile web add "D:\CodeSpace\personal\DSH_Plugin\dsh-skill-loom"
# then register the bundle (plugin_manager install_bundle with that absolute path)
# first install needs one dsh web restart: client modules are built at startup
dsh web
```

Later host-code changes take effect with `plugin_manager` disable + enable; only *new client modules* need a restart.

## Usage

Tell the agent what you want ("build a review role with code-review and git skills, no file writes") and it drives `role_graph`. Deleting a role is UI-only by design.

In the UI: drag a skill onto the role node to include it, onto another skill node to make it depend on that skill; drag a node's grip handle to the trash zone to remove it; drag an edge's midpoint away to delete the edge; drag a session row onto the role node to bind it.

## Data and boundaries

- Role graphs: `$DSH_HOME/roles/<uuid>.json` (atomic writes, per-role revisions).
- Session bindings: `$DSH_HOME/roles/bindings.json`.
- Read routes `GET /skill-loom/roles` and `GET /skill-loom/sessions`; writes accept only member, edge, persona, delete and binding actions, with same-origin checks and a body-size cap.
- Uninstalling does **not** delete role data automatically.

## Development

```powershell
node --test    # 172 unit tests
```

No build step: host and client halves are plain ESM JavaScript.

## License

[MIT](LICENSE)
