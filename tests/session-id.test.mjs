import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IM_ORIGIN,
  IM_SESSION_PREFIX,
  IM_SESSION_PREFIX_LEGACY,
  createImSessionId,
  isImOrigin,
  isImSessionId,
  isTaskSession,
  parseImSessionId,
  sessionKeyOf,
} from '../lib/engine/session-id.js'

test('新建 IM 会话使用统一 UUID 格式', () => {
  const id = createImSessionId()
  // 与自动化任务同族的命名：dsh-<来源>-session-<UUID>，全字符路径安全。
  assert.match(id, /^dsh-im-session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.equal(isImSessionId(id), true)
  assert.equal(isImOrigin(IM_ORIGIN), true)
  assert.equal(sessionKeyOf('wecom', 'group', 'woOoKtPAAAAvBcwwV96r5Uw'), 'wecom:group:woOoKtPAAAAvBcwwV96r5Uw')
})

test('前缀常量区分新旧两代格式', () => {
  assert.equal(IM_SESSION_PREFIX, 'dsh-im-session-')
  assert.equal(IM_SESSION_PREFIX_LEGACY, 'im:')
})

test('连续新建不会产生重复 id', () => {
  const first = createImSessionId()
  const second = createImSessionId()
  assert.notEqual(first, second)
  // 新格式不再把聊天目标编进 id，归属以会话映射为准。
  assert.equal(parseImSessionId(first), undefined)
  assert.equal(parseImSessionId(second), undefined)
})

test('旧格式会话仍可反解归属', () => {
  assert.deepEqual(parseImSessionId('im:weixin:dm:1786881038856:o9cq802KqrxiODVTN9zoEjur3Ayw@im.wechat'), {
    channel: 'weixin',
    kind: 'dm',
    chatId: 'o9cq802KqrxiODVTN9zoEjur3Ayw@im.wechat',
  })
  // 早期没有时间戳的旧格式同样兼容。
  assert.deepEqual(parseImSessionId('im:weixin:dm:o9cq802KqrxiODVTN9zoEjur3Ayw@im.wechat'), {
    channel: 'weixin',
    kind: 'dm',
    chatId: 'o9cq802KqrxiODVTN9zoEjur3Ayw@im.wechat',
  })
  assert.equal(parseImSessionId('im:weixin'), undefined)
})

test('多账号实例 ID 进入独立会话命名空间', () => {
  assert.equal(sessionKeyOf('weixin_a1b2c3', 'dm', 'same-user'), 'weixin_a1b2c3:dm:same-user')
  assert.deepEqual(parseImSessionId('im:weixin_a1b2c3:dm:1786881038856:same-user'), {
    channel: 'weixin_a1b2c3', kind: 'dm', chatId: 'same-user',
  })
  assert.equal(parseImSessionId('im:unknown_a1:dm:1786881038856:user'), undefined)
})

test('Slack 会话 id 能恢复，线程号里的波浪线留在 chatId', () => {
  assert.deepEqual(parseImSessionId('im:slack:dm:1786881038856:D01ABC'), {
    channel: 'slack', kind: 'dm', chatId: 'D01ABC',
  })
  assert.deepEqual(parseImSessionId('im:slack_a1b2c3:group:1786881038856:C01ABC~1700000000.000100'), {
    channel: 'slack_a1b2c3', kind: 'group', chatId: 'C01ABC~1700000000.000100',
  })
})

test('任务列表必须滤掉 IM 会话', () => {
  assert.equal(isTaskSession({ id: 'web-1', origin: 'user' }), true)
  assert.equal(isTaskSession({ id: 'im:wecom:dm:1', origin: 'im' }), false)
  assert.equal(isTaskSession({ id: 'im:wecom:dm:1' }), false)
  assert.equal(isTaskSession({ id: 'dsh-im-session-550e8400-e29b-41d4-a716-446655440000' }), false)
  assert.equal(isTaskSession({ id: 'x', origin: 'subagent' }), false)
  assert.equal(isTaskSession({ id: 'x', blank: true }), false)
})
