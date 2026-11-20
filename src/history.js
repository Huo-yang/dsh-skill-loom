/**
 * Undo/redo stacks for role graphs, kept in memory.
 *
 * The store on disk is the only truth; this module holds the *previous* states of
 * roles so an edit can be walked back. Every snapshot is a complete role object,
 * so restoring one is a normal save: it gets a fresh revision and nothing else in
 * the system has to know that an undo happened.
 *
 * Lifetime is the host process. Restarting clears the stacks, which is the
 * documented trade-off for not writing a second copy of every revision to disk.
 *
 * @module dsh-skill-loom/history
 */

/** Default depth per role. */
export const DEFAULT_LIMIT = 20

/**
 * Create the per-role undo/redo stacks.
 * @param {{ limit?: number }} [options] - how many steps to keep per role.
 * @returns {object} the history controller.
 */
export function createHistory(options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT
  const stacks = new Map()

  const entryOf = id => {
    let entry = stacks.get(id)
    if (entry === undefined) {
      entry = { undo: [], redo: [] }
      stacks.set(id, entry)
    }
    return entry
  }

  const trim = list => {
    while (list.length > limit) list.shift()
  }

  return {
    /**
     * Remember the state a change is about to replace.
     * @param {string} id - role id.
     * @param {object} snapshot - the role as it was before the change.
     */
    record(id, snapshot) {
      if (snapshot === undefined || snapshot === null) return
      const entry = entryOf(id)
      entry.undo.push(snapshot)
      trim(entry.undo)
      // A new edit invalidates the redo branch, as in any editor.
      entry.redo.length = 0
    },

    /**
     * Pop one step back, pushing the current state onto the redo stack.
     * @param {string} id - role id.
     * @param {object} current - the role as it is now.
     * @returns {object | undefined} the state to restore, or undefined when empty.
     */
    takeUndo(id, current) {
      const entry = entryOf(id)
      const previous = entry.undo.pop()
      if (previous === undefined) return undefined
      if (current !== undefined) {
        entry.redo.push(current)
        trim(entry.redo)
      }
      return previous
    },

    /**
     * Pop one step forward, pushing the current state back onto the undo stack.
     * @param {string} id - role id.
     * @param {object} current - the role as it is now.
     * @returns {object | undefined} the state to restore, or undefined when empty.
     */
    takeRedo(id, current) {
      const entry = entryOf(id)
      const next = entry.redo.pop()
      if (next === undefined) return undefined
      if (current !== undefined) {
        entry.undo.push(current)
        trim(entry.undo)
      }
      return next
    },

    /**
     * How many steps are available.
     * @param {string} id - role id.
     * @returns {{ undo: number, redo: number }} counts.
     */
    counts(id) {
      const entry = stacks.get(id)
      return { undo: entry?.undo.length ?? 0, redo: entry?.redo.length ?? 0 }
    },

    /**
     * Drop a role's history, e.g. after the role itself is deleted.
     * @param {string} id - role id.
     */
    forget(id) {
      stacks.delete(id)
    },
  }
}
