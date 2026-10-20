import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const membership = source.slice(source.indexOf('    let channelSessionIds'), source.indexOf('    const api ='))
const create = new Function(membership + '; return { updateChannelMembership, followSidebarTab, isHostNewSessionControl };')

test('频道会话不自动改页签，普通会话切回任务，定时认领的不抢', () => {
  const f = create()
  f.updateChannelMembership([{ sessions: [{ sessionId: 'session-adopted' }] }])
  const schedule = [{ id: 'schedule', matchSession: (id) => id === 'session-scheduled' }]
  const tasks = [{ id: 'notes', matchSession: (id) => id === 'session-noted' }]
  const channels = [{ id: 'channels', matchSession: () => true }]

  assert.equal(f.followSidebarTab({ ready: false, previousId: null }, 'im:weixin:1', []).tab, null)
  assert.equal(f.followSidebarTab({ ready: false, previousId: null }, 'im:weixin:1', [], 'tasks').tab, null)
  assert.equal(f.followSidebarTab({ ready: false, previousId: null }, 'im:weixin:1', [], 'channels').tab, null)
  assert.equal(f.followSidebarTab({ ready: true, previousId: 'im:weixin:1' }, 'session-new', []).tab, 'tasks')
  assert.equal(f.followSidebarTab({ ready: false, previousId: null }, 'session-new', []).tab, null)
  assert.equal(f.followSidebarTab({ ready: true, previousId: 'session-new' }, 'session-adopted', []).tab, null)
  assert.equal(f.followSidebarTab({ ready: true, previousId: 'session-new' }, 'session-adopted', [], 'channels').tab, null)
  assert.equal(f.followSidebarTab({ ready: true, previousId: 'session-new' }, 'session-adopted', [], 'tasks').tab, null)
  assert.equal(f.followSidebarTab({ ready: true, previousId: 'session-new' }, 'session-new', []).tab, null)
  assert.equal(f.followSidebarTab({ ready: true, previousId: 'im:weixin:1' }, 'session-scheduled', schedule).tab, null)
  assert.equal(f.followSidebarTab({ ready: true, previousId: 'im:weixin:1' }, 'session-noted', tasks).tab, 'notes')
  assert.equal(f.followSidebarTab({ ready: true, previousId: 'session-new' }, 'session-channel', channels, 'tasks').tab, null)
  assert.equal(f.followSidebarTab({ ready: true, previousId: 'session-new' }, 'session-channel', channels, 'channels').tab, null)
  assert.equal(f.isHostNewSessionControl('新会话\nCtrl'), true)
  assert.equal(f.isHostNewSessionControl('新建任务'), true)
  assert.equal(f.isHostNewSessionControl('频道'), false)
})

test('首次快照和迟到的主会话保留用户已选择的协作页签', () => {
  const f = create()
  const pending = f.followSidebarTab({ ready: false, previousId: null }, null, [], 'schedule')
  assert.equal(pending.ready, false)
  assert.equal(pending.tab, null)
  assert.equal(f.followSidebarTab(pending, 'normal', [], 'schedule').tab, null)
})

test('新建控件只匹配完整名称和快捷键，不匹配会话标题子串', () => {
  const f = create()
  for (const label of ['排查 New chat 错误', '新建任务的回归测试', 'New session notes']) {
    assert.equal(f.isHostNewSessionControl(label), false)
  }
  assert.equal(f.isHostNewSessionControl('New chat\nCtrl+N'), true)
})

test('侧栏跟随订阅当前会话 id，而不是整份会话快照', () => {
  const effect = source.slice(source.indexOf('function SessionSwitcher'), source.indexOf('function sidebarOccupantName'))
  assert.match(effect, /rawUseSessions\(\(state\) => currentSessionId\(state\)\)/)
})
