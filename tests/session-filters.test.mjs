import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { extractBlock } from './sidebar-lifecycle-harness.mjs'

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const code = extractBlock(
  client,
  '    const registryFilterCache = new WeakMap();',
  '    function SessionSwitcher(props) {',
  '统一会话过滤器',
)
const { applySessionFilters, createNativeTabRegistry, openRegisteredSession } = new Function(
  `${code}; return { applySessionFilters, createNativeTabRegistry, openRegisteredSession };`,
)()

test('统一会话过滤器保留当前会话，并在增删过滤器后随 revision 重新计算', () => {
  const registry = createNativeTabRegistry(null)
  const state = {
    ids: ['a', 'b'],
    byId: { a: { id: 'a' }, b: { id: 'b' } },
    current: 'a',
  }
  assert.equal(applySessionFilters(state, registry), state)
  const dispose = registry.addSessionFilter(id => id !== 'b')
  assert.equal(registry.getRevision(), 1)
  const filtered = applySessionFilters(state, registry)
  assert.deepEqual(filtered.ids, ['a'])
  assert.deepEqual(Object.keys(filtered.byId), ['a'])
  assert.equal(filtered.current, 'a')
  dispose()
  assert.equal(registry.getRevision(), 2)
  assert.equal(applySessionFilters(state, registry), state)
})

test('会话打开器按 order 分发，未匹配时回退宿主', () => {
  const registry = createNativeTabRegistry(null)
  const calls = []
  registry.addSessionOpener({
    id: 'im',
    order: 20,
    matchSession: () => true,
    open: id => { calls.push(`im:${id}`) },
  })
  const dispose = registry.addSessionOpener({
    id: 'automation',
    order: 10,
    matchSession: id => id.startsWith('dsh-automation-session-'),
    open: id => { calls.push(`automation:${id}`) },
  })
  openRegisteredSession('dsh-automation-session-1', registry, id => { calls.push(`host:${id}`) })
  openRegisteredSession('normal', registry, id => { calls.push(`host:${id}`) })
  dispose()
  openRegisteredSession('dsh-automation-session-2', registry, id => { calls.push(`host:${id}`) })
  assert.deepEqual(calls, [
    'automation:dsh-automation-session-1',
    'im:normal',
    'im:dsh-automation-session-2',
  ])
})
