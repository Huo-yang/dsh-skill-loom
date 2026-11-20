/**
 * Session -> role binding.
 *
 * Runtime state, deliberately kept out of the per-role files: switching a
 * session's role must not rewrite a role graph.
 *
 * @module dsh-skill-loom/bindings
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Absolute path of the bindings document inside a roles directory.
 * @param {string} rolesDir - the roles directory.
 * @returns {string} path of `bindings.json` beside the role files.
 */
export function bindingsFileFor(rolesDir) {
  return join(rolesDir, 'bindings.json')
}

/** A tiny JSON document mapping session ids to role ids. */
export class BindingStore {
  /**
   * @param {string} file - absolute path of `bindings.json`.
   */
  constructor(file) {
    if (typeof file !== 'string' || file === '') throw new TypeError('BindingStore requires a file path')
    this.file = file
    this.cache = undefined
  }

  async load() {
    if (this.cache !== undefined) return this.cache
    const empty = { schema: 1, bindings: {} }
    let text
    try {
      text = await readFile(this.file, 'utf8')
    } catch {
      this.cache = empty
      return this.cache
    }
    try {
      const parsed = JSON.parse(text)
      const bindings = parsed?.bindings
      this.cache = {
        schema: 1,
        bindings: bindings !== null && typeof bindings === 'object' ? { ...bindings } : {},
      }
    } catch {
      // A corrupt bindings file only loses session->role links; roles themselves
      // stay intact, so starting empty is safe and never blocks a session.
      this.cache = empty
    }
    return this.cache
  }

  /**
   * Resolve a session's role id.
   * @param {string} sessionId - session identity.
   * @returns {Promise<string | undefined>} bound role id, if any.
   */
  async get(sessionId) {
    const state = await this.load()
    const entry = state.bindings[sessionId]
    return typeof entry?.roleId === 'string' ? entry.roleId : undefined
  }

  /**
   * Bind a session to a role and persist atomically.
   * @param {string} sessionId - session identity.
   * @param {string} roleId - role UUID.
   * @returns {Promise<void>} resolves after the write.
   */
  async set(sessionId, roleId) {
    const state = await this.load()
    state.bindings[sessionId] = { roleId, boundAt: new Date().toISOString() }
    await this.flush()
  }

  /**
   * Drop a session's binding.
   * @param {string} sessionId - session identity.
   * @returns {Promise<boolean>} whether something was removed.
   */
  async clear(sessionId) {
    const state = await this.load()
    if (!(sessionId in state.bindings)) return false
    delete state.bindings[sessionId]
    await this.flush()
    return true
  }

  /** Write the whole document atomically. */
  async flush() {
    const state = await this.load()
    await mkdir(dirname(this.file), { recursive: true })
    const temp = `${this.file}.tmp`
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temp, this.file)
  }
}
