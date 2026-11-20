import assert from 'node:assert/strict'
import test from 'node:test'

import { restoreBoundRoles, sessionIdOf } from '../src/lifecycle.js'

const agent = id => ({ session: { header: { id } } })

test('sessionIdOf tolerates partial agents', () => {
  assert.equal(sessionIdOf(agent('s1')), 's1')
  assert.equal(sessionIdOf({}), undefined)
  assert.equal(sessionIdOf({ session: {} }), undefined)
  assert.equal(sessionIdOf(undefined), undefined)
})

test('only bound sessions are installed', async () => {
  const installed = []
  const result = await restoreBoundRoles({
    agents: [agent('s1'), agent('s2')],
    boundRoleFor: async id => (id === 's1' ? { id: 'r1' } : undefined),
    installRoleFor: async (_agent, id, role) => {
      installed.push([id, role.id])
    },
  })
  assert.deepEqual(installed, [['s1', 'r1']])
  assert.deepEqual(result, { restored: ['s1'], failed: [] })
})

test('one failing session does not stop the others', async () => {
  const failures = []
  const result = await restoreBoundRoles({
    agents: [agent('bad'), agent('good')],
    boundRoleFor: async () => ({ id: 'r1' }),
    installRoleFor: async (_agent, id) => {
      if (id === 'bad') throw new Error('boom')
    },
    onError: (error, id) => failures.push([id, error.message]),
  })
  assert.deepEqual(result, { restored: ['good'], failed: ['bad'] })
  assert.deepEqual(failures, [['bad', 'boom']])
})

test('agents without a session id are skipped silently', async () => {
  const result = await restoreBoundRoles({
    agents: [{}, agent('s1')],
    boundRoleFor: async () => ({ id: 'r1' }),
    installRoleFor: async () => {},
  })
  assert.deepEqual(result, { restored: ['s1'], failed: [] })
})

test('an empty agent list is a no-op', async () => {
  const result = await restoreBoundRoles({
    agents: [],
    boundRoleFor: async () => {
      throw new Error('must not be called')
    },
    installRoleFor: async () => {},
  })
  assert.deepEqual(result, { restored: [], failed: [] })
})
