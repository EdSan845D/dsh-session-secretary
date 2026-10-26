import assert from 'node:assert/strict'
import test from 'node:test'
import { createLabelProvider } from '../../lib/secretary/label.js'

const row = (sessionId, overrides = {}) => ({ sessionId, ...overrides })

test('labelOf formats project and title with【】', async () => {
  const provider = createLabelProvider({
    list: async () => ({ items: [row('s1', { cwd: 'C:\\work\\proj1', projections: { values: { title: '修 bug' } } })] }),
  })
  assert.equal(await provider.labelOf('s1'), '【proj1·修 bug】')
})

test('labelOf falls back to session id head without title and 未知项目 without cwd', async () => {
  const provider = createLabelProvider({ list: async () => ({ items: [row('abcdefghij')] }) })
  assert.equal(await provider.labelOf('abcdefghij'), '【未知项目·abcdefgh】')
})

test('labelOf returns empty string when the session is unknown or list fails', async () => {
  const provider = createLabelProvider({ list: async () => ({ items: [] }) })
  assert.equal(await provider.labelOf('missing'), '')
  const failing = createLabelProvider({ list: async () => { throw new Error('down') } })
  assert.equal(await failing.labelOf('s1'), '')
})

test('list result is cached for 30s and invalidate() forces a reload', async () => {
  let calls = 0
  let items = [row('s1', { cwd: 'C:\\w\\p', projections: { values: { title: 't1' } } })]
  const provider = createLabelProvider({ list: async () => { calls += 1; return { items } } })
  await provider.labelOf('s1')
  await provider.labelOf('s1')
  await provider.labelOf('s1')
  assert.equal(calls, 1)
  provider.invalidate()
  items = [row('s1', { cwd: 'C:\\w\\p', projections: { values: { title: 't2' } } })]
  assert.equal(await provider.labelOf('s1'), '【p·t2】')
  assert.equal(calls, 2)
})
