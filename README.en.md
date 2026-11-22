<h1 align="center">Skill Loom</h1>

<p align="center"><a href="https://www.npmjs.com/package/@huo-yang/dsh-skill-loom"><img src="https://img.shields.io/npm/v/@huo-yang/dsh-skill-loom" alt="npm version"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a> <img src="https://img.shields.io/badge/Node.js-22%2B-brightgreen" alt="Node.js 22 or later"></p>

<p align="center"><a href="README.md">简体中文</a> · <strong>English</strong></p>

Skill Loom organizes skills into visual roles and reusable ability families. A DSH session bound to a role sees only the skills in that role whose dependencies are healthy. This keeps the skill context smaller and makes prerequisites visible to both the agent and the person editing the graph.

## Features

- **Role editing.** Drag to add or remove skills and dependencies. Search the library, hover to inspect skills, and undo or redo changes. Drafts survive a refresh and take effect when saved.
- **Ability families.** Save frequently used skills and their dependencies as reusable subgraphs.
- **Session binding.** Choose a role when starting a conversation to apply its persona and available skill catalog.
- **Dependency health.** Missing skills appear red. Skills that depend on them directly or indirectly appear gray.
- **Agent-assisted editing.** The built-in Skill Loom Assistant can create or update roles and ability families and open the result beside the conversation.

## Compatibility

| Item | Requirement or verified scope |
| --- | --- |
| Node.js | 22 or later |
| DSH interface | Web profile |
| Verified host | DSH Web 0.2.2-rc.5 on Windows |

## Install

```powershell
dsh plugin --profile web add @huo-yang/dsh-skill-loom
dsh web
```

Restart DSH Web if it is already running, then open Skill Loom from the left navigation or a conversation’s right sidebar. You can also download a `.tgz` from [GitHub Releases](https://github.com/Huo-yang/dsh-skill-loom/releases) and pass its path in place of the package name.

## Quick start

1. **Build a role.** Create a role and drag skills from the library onto its root. Drop a skill onto another skill to connect them. Drag an existing node to the canvas removal zone to remove it.
2. **Reuse an ability family.** An ability family stores related skills and their dependencies. Drop one onto the role root or another skill to add missing nodes and edges. Existing skills are shared.
3. **Save and bind.** Graph changes stay in a draft with undo and redo until you save. Choose a role next to the composer when starting a DSH conversation. Once it starts, use the session header to see the active role, switch it, or restore the default. Switching is unavailable while the session is running. The role description appears in the UI. The persona you set in the upper-right canvas controls is injected into bound sessions.
4. **Inspect health.** Red indicates a missing skill. Gray indicates a skill directly or indirectly blocked by a missing dependency. Hover over a skill to inspect its description, dependencies and membership.

### Let DSH edit the graph

Create a role, drop the built-in orchestration family onto its root and save. Start a conversation with that role, then describe the role or family you want DSH to build.

> Create a role for reviewing project documentation. Check its skill prerequisites, save the result, and open Skill Loom in this conversation’s right sidebar so I can review it.

DSH uses `role_graph` for roles, `role_family` to create, update and reuse families, and `role_review` to open the saved graph in the current Web conversation. An open editor preserves your unsaved draft.

## How DSH manages skills

Skill Loom builds on DSH's skill system rather than replacing its loader. DSH **discovers skills, resolves names by scope, shows a session catalog, and loads full instructions on demand**.

1. **Discovery.** The filesystem provider locates the project from the session's working directory and recognizes `<skill-name>/SKILL.md` and `<skill-name>.md`. Within a scope, the default filesystem precedence is project `.dsh/skills`, project `.agents/skills`, custom directories, the user's DSH skills directory, the user's Agents skills directory, then a bundled directory if configured. Plugins can also register non-filesystem providers.
2. **Resolution.** The `ctx.skills` registry combines host-wide skills with those on the current agent's scope chain. For a duplicate name, the nearest scope wins. Provider ranking only breaks ties within a scope, so a skill shown in the editor may not resolve in every session.
3. **Invocation.** When DSH's `skill` tool is available, the model sees the names and short descriptions of skills it can invoke, then uses the tool to load full instructions by name. A separate invocation setting controls whether the user can run a skill with `/skill-name`.

**What Loom changes.** When you bind a role, Loom checks its dependencies against the skills the target agent can resolve. Members with complete dependencies keep their original definitions. Loom shadows other discovered skills by name in that agent's scope, with both model and user invocation disabled. Unbinding removes the overrides. Loom does not rewrite skill files or change DSH's file, command, or network permissions.

For the version verified by this project, see the [DSH 0.2.2-rc.5 skill subsystem reference](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/docs/subsystems/skills.md#provider-registry).

## Scope

Binding controls the skill catalog and named skill loading for that conversation. Healthy skills can be loaded on demand. Missing, blocked and excluded skills are omitted and cannot be loaded by the skill tool. If the agent has permission to read a skill file, it can still read that file with a file tool. DSH controls file, command and network permissions.

Roles, families and bindings live under `roles` in the DSH data directory. Unsaved graph drafts stay in the current browser.

## Development

```powershell
npm run check
npm pack --dry-run
```

[Contribution guide](CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

## Uninstall

```powershell
dsh plugin --profile web remove @huo-yang/dsh-skill-loom
```

Restart DSH Web to apply the change. Uninstalling preserves roles, ability families, and binding records in the data directory.

## License

Released under the [MIT license](LICENSE).
