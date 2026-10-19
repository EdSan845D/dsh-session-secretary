import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// 执行客户端实际分类和缓存逻辑，验证归属异步刷新后的结果。
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const membership = source.slice(source.indexOf('    let channelSessionIds'), source.indexOf('    const api ='))
const create = new Function(membership + '; return { updateChannelMembership, channelIdOfSession, isChannelSession, subscribeChannelMembership };')

test('普通 Host ID 按渠道索引分类，归属变更使同一快照的缓存失效', () => {
  const f = create()
  assert.equal(f.isChannelSession('im:old'), true)
  assert.equal(f.isChannelSession('session-adopted'), false)
  let changes = 0
  const stop = f.subscribeChannelMembership(() => changes++)
  f.updateChannelMembership([{ id: 'wecom', sessions: [{ sessionId: 'session-adopted' }] }])
  assert.equal(f.isChannelSession('session-adopted'), true)
  assert.equal(f.channelIdOfSession('session-adopted'), 'wecom')
  assert.equal(f.channelIdOfSession('im:weixin:dm:1:chat'), 'weixin')
  assert.equal(f.channelIdOfSession('im:wecom_bot:group:1:chat'), 'wecom')
  assert.equal(f.channelIdOfSession('task'), undefined)
  f.updateChannelMembership([{ id: 'wecom', sessions: [{ sessionId: 'session-adopted' }] }])
  assert.equal(changes, 1)
  f.updateChannelMembership([])
  assert.equal(f.isChannelSession('session-adopted'), false)
  stop()
})
