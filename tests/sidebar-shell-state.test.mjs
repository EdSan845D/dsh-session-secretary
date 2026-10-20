import assert from 'node:assert/strict'
import test from 'node:test'
import { createImShellHarness } from './sidebar-shell-harness.mjs'

function fixture(initial = {}) {
  const values = new Map(Object.entries(initial))
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const shell = createImShellHarness(storage)
  const tabs = [{ id: 'schedule', label: '定时', render: () => ({ type: 'schedule-view' }) }]
  const props = { nativeTabs: { getTabs: () => tabs, getRevision: () => 0, subscribe: () => () => {} } }
  const render = () => shell.render(props)
  const selected = tree => tree.props.children[0].props.children[0].props.value
  return { shell, tabs, props, render, selected, values }
}

test('IM 首次载入普通会话时保留旧版已选定时，并迁移共享存储', () => {
  const f = fixture({ 'dsh-im-connect.sidebar-tab': 'schedule' })
  f.props.useSessions = select => select({ current: 'normal' })
  assert.equal(f.selected(f.render()), 'schedule')
  assert.equal(f.values.get('dsh-native-sidebar.tab'), 'schedule')
})

test('自动化卸载后回到有效任务页，重新接入可恢复定时', () => {
  const f = fixture({ 'dsh-native-sidebar.tab': 'schedule' })
  assert.equal(f.selected(f.render()), 'schedule')
  f.tabs.length = 0
  const tree = f.render()
  assert.equal(f.selected(tree), 'tasks')
  assert.notEqual(tree.props.children[1].type, 'channel-view')
  f.tabs.push({ id: 'schedule', label: '定时', render: () => ({ type: 'schedule-view' }) })
  assert.equal(f.selected(f.render()), 'schedule')
})

test('普通会话变化仍跟随任务，但会话行点击不能被当作新建控件', () => {
  const f = fixture({ 'dsh-native-sidebar.tab': 'schedule' })
  let current = null
  f.props.useSessions = select => select({ current })
  f.render()
  current = 'normal'
  assert.equal(f.selected(f.render()), 'schedule')
  f.shell.click({ innerText: 'New chat', getAttribute: () => null, closest: selector => selector === 'button' ? { innerText: 'New chat', getAttribute: () => null, closest: () => ({}) } : null })
  assert.equal(f.selected(f.render()), 'schedule')
  current = 'another-normal'
  assert.equal(f.selected(f.render()), 'tasks')
})
