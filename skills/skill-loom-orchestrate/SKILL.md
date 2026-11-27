---
name: skill-loom-orchestrate
description: Organize skills around a user's goal by creating or updating DSH roles and ability families.
---

Call role_graph with action "list" to inspect existing roles and the skill catalog. Select only skills that serve the user's goal.

Use role_graph actions "create", "add_members", and "link" to compose a role. Add an edge when a skill actually requires another skill. Set "from" to the consumer and "to" to its prerequisite. Explain the dependency in "why".

Before changing an existing role, inspect it with "show". Use "plan" or "show" to check the runtime, red, and gray lists. Leave unavailable skills out of the new graph.

For skill retirement, call skill_retirement with action "help", then "inspect" or "propose" and the exact skill name. These calls are read-only. Report every saved role/family reference, conflict constraint, and dependency path. Propose explicit graph edits; never apply cleanup without the user's authorization. Draft cleanup does not count: save each approved graph change, then inspect again. Preserve missing/blocked diagnostics; do not erase dependency edges or anchors just to make the graph green.

Only when the user explicitly requests retirement or restoration, call skill_retirement with action "retire" or "restore", name, confirm=true, and the fresh revision from inspect. If references remain, the catalog is uncertain, or the revision is stale, stop and report the blocker; do not retry writes with guessed revisions. Retirement is persistent Loom state only, shared by all providers/scopes with that name. Never delete SKILL.md, uninstall providers, or modify DSH settings. Reappearing files do not restore the skill automatically. Restore before adding a retired name to a role/family. The two built-in Loom management skills cannot be retired.

Use role_family with action "list" to inspect reusable families. Use "create" to save a new family and pass an empty "edges" array if it has no dependencies. For changes, use "show" to obtain the revision before calling "update". Use "apply" to insert a family into a role.

After saving and checking the configuration, load skill-loom-review to open the graph in the current DSH conversation sidebar.

### Create descriptions and explicit cleanup previews

`role_graph({action:"create", name:"Document review", description:"Review document accuracy and clarity", add:[]})` preserves the supplied role description. Use the user's intended summary; never invent one just to fill the field. Description is optional for old calls, whitespace is normalized, and the limit is 160 characters, exactly as for `set_description`. Read back with `show`/`list`; description is separate from `persona`.

Before removing skill B, inspect `skill_retirement({action:"propose", name:"B"})` and, for a role, `role_graph({action:"plan", role:"<id>", remove:["B"]})`. Review `draft`, `removedEdges` and `removedConflicts`: removing B from A→B removes that requirement and changes A's meaning. Obtain explicit authorization for those graph changes; only then call `remove_members` with the same removal and `expectedRevision` from `plan.draft.revision` (reject and review again if stale), or save the user's revised graph. A preview never clears saved references. Confirm retirement separately using a fresh retirement revision. Do not edit immutable system families; custom families must remain valid. Keep missing-file diagnostics distinct from unresolved catalog discovery and retirement state.

### Explicit ability-family template deletion

To delete a family template, first use `role_family` with `list`/`show` and present its exact ID, current revision and name. Explain that only the saved template is deleted: skill files and graphs already applied to roles are unchanged. Obtain the user's explicit confirmation for this deletion, then call `role_family({action:"delete", family:"<exact-id>", revision:1, confirm:true})`, replacing `1` with the revision the user reviewed. Never use a display name for deletion, infer confirmation from an audit/cleanup request, or fetch a newer revision to silently retry. Missing, invalid or stale revisions must stop deletion; show the latest record and seek a new decision. Built-in templates cannot be deleted. Deleting a template does not clear role references for skill retirement; inspect saved references again.
