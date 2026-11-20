/**
 * Per-role persistence: one JSON file per role, named by its UUID.
 *
 * Layout under the roles directory:
 *   <uuid>.json          one role graph
 *   bindings.json        session -> role (runtime state, owned elsewhere)
 *
 * Guarantees:
 *   - writes are atomic (same-directory temp file, then rename);
 *   - a corrupt file is moved aside, never silently deleted;
 *   - every write bumps `revision`, and a stale expected revision is a conflict;
 *   - display names stay unique across roles, compared case-insensitively.
 *
 * @module dsh-skill-loom/store
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isRoleNameTaken, validateRoleId, validateRoleName } from './graph.js'

/** Thrown when a write would overwrite a newer revision. */
export class RoleConflictError extends Error {
  /**
   * @param {string} id - role id.
   * @param {number | undefined} expected - revision the writer had seen.
   * @param {number} actual - revision currently on disk.
   */
  constructor(id, expected, actual) {
    super(`role ${id} changed since it was read (expected revision ${String(expected)}, found ${actual})`)
    this.name = 'RoleConflictError'
    this.id = id
    this.expected = expected
    this.actual = actual
  }
}

/** Thrown when a role breaks a storage rule. */
export class RoleValidationError extends Error {
  /**
   * @param {string} message - human-readable reason.
   * @param {string} code - stable machine code.
   */
  constructor(message, code) {
    super(message)
    this.name = 'RoleValidationError'
    this.code = code
  }
}

/**
 * A directory of per-role JSON files.
 */
export class RoleStore {
  /**
   * @param {string} directory - absolute path of the roles directory.
   */
  constructor(directory) {
    if (typeof directory !== 'string' || directory === '') {
      throw new TypeError('RoleStore requires a directory path')
    }
    this.directory = directory
  }

  /** Create the directory when missing. Safe to call repeatedly. */
  async init() {
    await mkdir(this.directory, { recursive: true })
  }

  /** Absolute path of a role's file. */
  fileOf(id) {
    return join(this.directory, `${id}.json`)
  }

  /**
   * Read one role.
   * @param {string} id - role id.
   * @returns {Promise<object | undefined>} the role, or undefined when absent.
   */
  async read(id) {
    const verdict = validateRoleId(id)
    if (!verdict.ok) throw new RoleValidationError(`invalid role id (${verdict.reason})`, 'invalid-id')
    let text
    try {
      text = await readFile(this.fileOf(id), 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
    try {
      return JSON.parse(text)
    } catch {
      await this.quarantine(id)
      return undefined
    }
  }

  /**
   * Read every role, quarantining files that do not parse.
   * @returns {Promise<object[]>} roles in `<uuid>` order.
   */
  async readAll() {
    await this.init()
    const entries = await readdir(this.directory)
    const roles = []
    for (const entry of entries) {
      if (!entry.endsWith('.json') || entry === 'bindings.json') continue
      const id = entry.slice(0, -'.json'.length)
      if (!validateRoleId(id).ok) continue
      const role = await this.read(id)
      if (role !== undefined) roles.push(role)
    }
    return roles.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  }

  /**
   * Persist a role.
   *
   * The caller supplies the id; this method assigns `revision`. A role that is
   * new starts at 1. `expectedRevision` is optional: omit it for a deliberate
   * last-writer-wins write, pass it to detect a concurrent edit.
   * @param {object} role - role graph to write.
   * @param {{ expectedRevision?: number }} [options] - concurrency control.
   * @returns {Promise<object>} the written role, with its new revision.
   */
  async save(role, options = {}) {
    const idVerdict = validateRoleId(role?.id)
    if (!idVerdict.ok) throw new RoleValidationError(`invalid role id (${idVerdict.reason})`, 'invalid-id')
    const nameVerdict = validateRoleName(role?.name)
    if (!nameVerdict.ok) throw new RoleValidationError(`invalid role name (${nameVerdict.reason})`, 'invalid-name')

    const others = (await this.readAll()).filter(existing => existing.id !== role.id)
    if (isRoleNameTaken(others, role.name)) {
      throw new RoleValidationError(`role name "${role.name}" is already used by another role`, 'duplicate-name')
    }

    const existing = await this.read(role.id)
    const previous = typeof existing?.revision === 'number' ? existing.revision : 0
    if (options.expectedRevision !== undefined && options.expectedRevision !== previous) {
      throw new RoleConflictError(role.id, options.expectedRevision, previous)
    }

    const next = { ...role, revision: previous + 1 }
    const file = this.fileOf(role.id)
    const temp = `${file}.tmp`
    await this.init()
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    await rename(temp, file)
    return next
  }

  /**
   * Delete a role. Deleting a role deletes its graph; there is nothing else to
   * clean up because skills are only referenced by name.
   * @param {string} id - role id.
   * @returns {Promise<boolean>} whether a file was removed.
   */
  async remove(id) {
    const verdict = validateRoleId(id)
    if (!verdict.ok) throw new RoleValidationError(`invalid role id (${verdict.reason})`, 'invalid-id')
    try {
      await rm(this.fileOf(id))
      return true
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      throw error
    }
  }

  /**
   * Move an unreadable file aside so the failure stays inspectable.
   * @param {string} id - role id.
   */
  async quarantine(id) {
    const stamp = new Date().toISOString().replaceAll(':', '-')
    await rename(this.fileOf(id), `${this.fileOf(id)}.corrupt-${stamp}`)
  }
}
