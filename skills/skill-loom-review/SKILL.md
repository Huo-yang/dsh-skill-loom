---
name: skill-loom-review
description: Verify a saved DSH role or ability family and open its graph in the current conversation sidebar.
---

Use role_graph or role_family with action "show" to verify the saved skills and dependencies. Report any missing or blocked skills.

Use skill_retirement "list" or "inspect" to distinguish retirement from missing/unloaded/unknown availability. Report saved role/family references, conflicts, and dependency paths; "propose" suggests cleanup without changing anything. A review, a missing skill, or a failed lookup must never trigger retirement, restoration, or graph cleanup. Draft edits do not remove saved references. Preserve missing-file anchors and red/gray diagnostics.

For an explicitly requested retirement/restoration only, inspect afresh and use skill_retirement "retire"/"restore" with the exact name, confirm=true, and the returned revision. Explain that this affects Loom only, leaves provider files and other applications unchanged, persists across restarts and file reappearance, and applies to all same-name providers/scopes. Restore before referencing a retired skill again. Report protected management skills and stale/busy/uncertain-state failures without silently writing or retrying. If cleanup is needed, ask the user to authorize edits to the named graphs and save them before another retirement attempt.

When reviewing a role or family, before replying call role_review with exactly one target. Pass "role" to show a role or "family" to show an ability family. A skill-only inspection does not need a role_review request or a fabricated graph target.

Summarize the result and any decisions the user still needs to make. Modify existing roles, session bindings, or user data only as requested.

### Create descriptions and explicit cleanup previews

`role_graph({action:"create", name:"Document review", description:"Review document accuracy and clarity", add:[]})` preserves the supplied role description. Use the user's intended summary; never invent one just to fill the field. Description is optional for old calls, whitespace is normalized, and the limit is 160 characters, exactly as for `set_description`. Read back with `show`/`list`; description is separate from `persona`.

Before removing skill B, inspect `skill_retirement({action:"propose", name:"B"})` and, for a role, `role_graph({action:"plan", role:"<id>", remove:["B"]})`. Review `draft`, `removedEdges` and `removedConflicts`: removing B from A→B removes that requirement and changes A's meaning. Obtain explicit authorization for those graph changes; only then call `remove_members` with the same removal and `expectedRevision` from `plan.draft.revision` (reject and review again if stale), or save the user's revised graph. A preview never clears saved references. Confirm retirement separately using a fresh retirement revision. Do not edit immutable system families; custom families must remain valid. Keep missing-file diagnostics distinct from unresolved catalog discovery and retirement state.
