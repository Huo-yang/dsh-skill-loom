<h1 align="center">dsh-skill-loom</h1>

<p align="center">Weave skills into roles: manage "which skills this session should see" with a dependency graph</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.0.0--design-lightgrey" alt="Design stage" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/DSH-0.2.2--rc.5-blue" alt="DSH 0.2.2-rc.5" />
</p>

<p align="center"><a href="README.md">简体中文</a> | <strong>English</strong></p>

---

> **Status: design stage.** This repository has no installable plugin code yet — only an architecture design that has gone through several review rounds. Installation instructions will appear once M1 lands.

## The problem

DSH's skill catalog is process-wide: every session sees the same `<available_skills>`. Once dozens of skills are installed, every request carries all of their names and descriptions — it eats context and makes the model choose worse among many candidates.

The two existing workarounds are both incomplete:

| Approach | Mechanism | Gap |
|---|---|---|
| Agent Preset | Pick a plugin subset when a session is created | Locked once the session starts |
| Skill managers | Group filtering, on-demand exposure, per-item trimming | No "role" as a whole; switching means toggling items |

`dsh-skill-loom`'s position: **skills depend on each other, and those dependencies should be drawn rather than remembered.**

## Concepts

| Concept | Definition |
|---|---|
| **Repository** | A read-only projection over DSH's six skill roots — no copying, moving, or rewriting existing skills |
| **Role graph** | All orchestration state of one role, stored in one JSON file; the role itself is the DAG root |
| **Red node** | Referenced by the graph but unresolved in the repository (deleted, renamed, or broken frontmatter) |
| **Gray node** | Exists, but some upstream dependency is red or gray; **excluded from the runtime set** |
| **Healthy set** | The non-red, non-gray part of the role's members — what the session can actually see |

In one sentence: **the graph is intent, the repository is fact, and the difference between them is the observability.**

## Design highlights

- **One role, one graph, one file**: deleting a role deletes its graph; revisions are per role.
- **No layered taxonomy**: depth is derived per root, never authored. Authored layers rot.
- **Missing is visible**: red marks what is gone; its whole downstream turns gray and drops out of the runtime set.
- **The agent can orchestrate**: describe the role you want and the agent builds the graph; you inspect and adjust on the canvas.
- **Zero intrusion**: documented host services and client slots only — no monkey-patching, no fork, no profile surgery.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — decision log, data model, runtime semantics, native DSH interference surface, milestones. (Chinese)

## Roadmap

| Stage | Scope |
|---|---|
| M1 | Per-role storage, DAG validation, `role_graph` tool with `plan` |
| M2 | Runtime application (healthy set → shadows + persona) and `role_spawn` |
| M3 | Read-only graph UI (observability) |
| M4 | Editable graph UI (operability) |
| M5 | Concurrency, audit log, import/export |

## License

[MIT](LICENSE)
