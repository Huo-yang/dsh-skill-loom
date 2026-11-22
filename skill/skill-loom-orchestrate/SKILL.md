---
name: skill-loom-orchestrate
description: Organize skills around a user's goal by creating or updating DSH roles and ability families.
---

Call role_graph with action "list" to inspect existing roles and the skill catalog. Select only skills that serve the user's goal.

Use role_graph actions "create", "add_members", and "link" to compose a role. Add an edge when a skill actually requires another skill. Set "from" to the consumer and "to" to its prerequisite. Explain the dependency in "why".

Before changing an existing role, inspect it with "show". Use "plan" or "show" to check the runtime, red, and gray lists. Leave unavailable skills out of the new graph.

Use role_family with action "list" to inspect reusable families. Use "create" to save a new family and pass an empty "edges" array if it has no dependencies. For changes, use "show" to obtain the revision before calling "update". Use "apply" to insert a family into a role.

After saving and checking the configuration, load skill-loom-review to open the graph in the current DSH conversation sidebar.
