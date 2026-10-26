import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createControlChat, parseControlChatId } from '../../lib/secretary/control-chat.js'

const channel = (id, sent = []) => ({ id, send: async (_, text) => sent.push(text) })

test('parseControlChatId 解析 渠道:聊天 并拒绝畸形值', () => {
  assert.deepEqual(parseControlChatId('qq:12345'), { channelId: 'qq', chatId: '12345' })
  assert.equal(parseControlChatId(''), null)
  assert.equal(parseControlChatId('qq'), null)
  assert.equal(parseControlChatId('qq:'), null)
  assert.equal(parseControlChatId(':123'), null)
})

test('未配置时学习第一条 DM 并落盘；群聊不学习', () => {
  const dir = mkdtempSync(join(tmpdir(), 'control-chat-'))
  try {
    const file = join(dir, 'control-chat.json')
    const chat = createControlChat({ stateFile: file, logger: { warn: () => {} } })
    chat.resolve([channel('qq')])
    chat.observe({ channelId: 'qq', chatId: 'group1', kind: 'group' })
    assert.equal(chat.resolve([channel('qq', [])]), null, '群聊不学习')
    chat.observe({ channelId: 'qq', chatId: 'user1', kind: 'dm' })
    const target = chat.resolve([channel('qq', [])])
    assert.deepEqual(target, { channel: { id: 'qq', send: target?.channel.send }, chatId: 'user1' })
    const reopened = createControlChat({ stateFile: file, logger: { warn: () => {} } })
    assert.equal(reopened.resolve([channel('qq', [])])?.chatId, 'user1', '学习结果持久化')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('显式配置优先于学习结果，且不要求先学习', () => {
  const chat = createControlChat({ controlChatId: 'feishu:ou_9', stateFile: null, logger: { warn: () => {} } })
  const sent = []
  const target = chat.resolve([channel('qq', sent), channel('feishu', sent)])
  assert.deepEqual(target, { channel: { id: 'feishu', send: target?.channel.send }, chatId: 'ou_9' })
})

test('配置的渠道未连接时返回 null', () => {
  const chat = createControlChat({ controlChatId: 'telegram:x', stateFile: null, logger: { warn: () => {} } })
  assert.equal(chat.resolve([channel('qq')]), null)
})
