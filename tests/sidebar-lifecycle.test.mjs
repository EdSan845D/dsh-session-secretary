import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, extractBlock, lifecycleCases, nativeTabs } from './sidebar-lifecycle-harness.mjs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const body = extractBlock(source, '        let wrappedEntry = null;', '\n      });\n    }\n\n    exports.apply', 'IM 生命周期', ['notifyPeers', 'ownedWrapper', 'ownedRegistry'])
lifecycleCases(test, body, 'im')

test('带 component 的条目只发现当前组件注册表，不回退残留缓存', () => {
  const stale = nativeTabs.createNativeTabRegistry(null)
  const current = nativeTabs.createNativeTabRegistry(null)
  const component = function CurrentHost() {}
  component.__dshNativeTabs = current
  const entry = { component, __dshNativeTabs: stale }
  assert.equal(nativeTabs.findNativeTabRegistry(entry), current)
  entry.component = function PendingHost() {}
  assert.equal(nativeTabs.findNativeTabRegistry(entry), null)
  entry.component = null
  assert.equal(nativeTabs.findNativeTabRegistry(entry), null)
  entry.component = undefined
  assert.equal(nativeTabs.findNativeTabRegistry(entry), null)
  assert.equal(nativeTabs.findNativeTabRegistry(Object.create({ component })), current)
})

test('发现协议只接受 v1 的三个必需函数，并保留对象与函数直传', () => {
  const valid = { version: 1, getTabs() { return [] }, subscribe() {}, insert() {} }
  const direct = { __dshNativeTabs: valid }
  const component = function Host() {}
  component.__dshNativeTabs = valid
  for (const target of [direct, component, { component }]) {
    assert.equal(nativeTabs.findNativeTabRegistry(target), valid)
  }
  const malformed = [null, {}, { ...valid, version: 2 }, { ...valid, version: '1' }]
  for (const method of ['getTabs', 'subscribe', 'insert']) {
    malformed.push({ ...valid, [method]: undefined }, { ...valid, [method]: true })
  }
  for (const registry of malformed) {
    assert.equal(nativeTabs.findNativeTabRegistry({ __dshNativeTabs: registry }), null)
    assert.equal(nativeTabs.findNativeTabRegistry({ component: { __dshNativeTabs: registry }, __dshNativeTabs: valid }), null)
  }
  for (const target of [null, undefined, false, 1, 'entry']) {
    assert.equal(nativeTabs.findNativeTabRegistry(target), null)
  }
})

test('foreign host 换壳暂无注册表时立即撤出旧页签，通知后恢复且卸载只删自己的项', async () => {
  const h = createHarness(body, 'im'), entry = h.add()
  const oldRegistry = h.registry(null), nextRegistry = h.registry(null)
  const schedule = { id: 'schedule' }
  oldRegistry.insert(schedule)
  const host = function ForeignHost() {}
  host.__dshNativeTabHost = true
  host.__dshNativeTabs = oldRegistry
  entry.component = host
  entry.__dshNativeTabs = oldRegistry
  const stop = h.start()
  try {
    assert.deepEqual(oldRegistry.getTabs().map(tab => tab.id), ['schedule', 'channels'])
    const pendingHost = function PendingHost() {}
    pendingHost.__dshNativeTabHost = true
    entry.component = pendingHost
    h.window.dispatchEvent(new Event('dsh-native-sidebar-change'))
    await h.settle()
    assert.equal(entry.component, pendingHost)
    assert.deepEqual(oldRegistry.getTabs(), [schedule], '换壳即清理旧表的自有频道页签')
    assert.equal(entry.__dshNativeTabs, oldRegistry, '不修改其他插件的缓存')
    nextRegistry.insert(schedule)
    pendingHost.__dshNativeTabs = nextRegistry
    h.window.dispatchEvent(new Event('dsh-native-sidebar-change'))
    await h.settle()
    assert.deepEqual(nextRegistry.getTabs().map(tab => tab.id), ['schedule', 'channels'])
    const replacement = { id: 'channels', label: '其他实例' }
    nextRegistry.insert(replacement)
    stop()
    await h.settle()
    assert.equal(entry.component, pendingHost)
    assert.deepEqual(oldRegistry.getTabs(), [schedule])
    assert.deepEqual(nextRegistry.getTabs(), [schedule, replacement])
  } finally { stop() }
})

test('抽取拒绝缺失、重复、倒序标记和缺少必要标识符的闭包', () => {
  for (const invalid of ['', 'BEGIN body', 'body END', 'END BEGIN', 'BEGIN BEGIN END', 'BEGIN END END']) {
    assert.throws(() => extractBlock(invalid, 'BEGIN', 'END', '测试闭包'), /测试闭包.*标记/)
  }
  for (const marker of ['notifyPeers', 'ownedWrapper', 'ownedRegistry']) {
    assert.throws(() => extractBlock('BEGIN partial END', 'BEGIN', 'END', '测试闭包', [marker]), new RegExp(`缺少 ${marker}`))
  }
  assert.equal(extractBlock('BEGIN\r\nbody\r\nEND', 'BEGIN', '\nEND', '测试闭包'), 'BEGIN\nbody')
})

test('挂载期间有效重试保持同一包裹，接入后停止计时器', async () => {
  const h = createHarness(body, 'im'), entry = h.add()
  const stop = h.start(), wrapped = entry.component
  try {
    assert.equal(h.tick(), 1)
    assert.equal(entry.component, wrapped)
    await h.settle()
    assert.equal(h.tick(), 0)
    assert.equal(entry.component, wrapped)
  } finally { stop() }
})

test('真实注册表旧清理函数不能删除同名新页签或发送无效通知', () => {
  const registry = nativeTabs.createNativeTabRegistry(null)
  let changes = 0
  registry.subscribe(() => changes++)
  const removeOld = registry.insert({ id: 'channels', label: '旧页签' })
  const replacement = { id: 'channels', label: '新页签' }
  const removeNew = registry.insert(replacement)
  const before = changes
  removeOld()
  assert.deepEqual(registry.getTabs(), [replacement])
  assert.equal(changes, before)
  removeNew()
  assert.deepEqual(registry.getTabs(), [])
  assert.equal(changes, before + 1)
  removeNew()
  assert.equal(changes, before + 1)
})

test('真实注册表排序、快照和订阅解绑保持一致', () => {
  const registry = nativeTabs.createNativeTabRegistry(null)
  let changes = 0
  const unsubscribe = registry.subscribe(() => changes++)
  registry.insert({ id: 'later', order: 20 })
  const snapshot = registry.getTabs()
  const remove = registry.insert({ id: 'earlier', order: 10 })
  assert.deepEqual(registry.getTabs().map(tab => tab.id), ['earlier', 'later'])
  assert.deepEqual(snapshot.map(tab => tab.id), ['later'])
  assert.equal(registry.getTabs(), registry.getTabs())
  assert.equal(changes, 2)
  unsubscribe()
  remove()
  assert.deepEqual(registry.getTabs().map(tab => tab.id), ['later'])
  assert.equal(changes, 2)
})

test('真实注册表移除过滤器时保留其他插件的过滤器并通知订阅者', () => {
  const registry = nativeTabs.createNativeTabRegistry(null)
  const first = state => state, second = state => state
  let changes = 0
  registry.subscribe(() => changes++)
  const remove = registry.addSessionFilter(first)
  registry.addSessionFilter(second)
  assert.deepEqual(registry.sessionFilters, [first, second])
  remove()
  assert.deepEqual(registry.sessionFilters, [second])
  assert.equal(changes, 3)
})
