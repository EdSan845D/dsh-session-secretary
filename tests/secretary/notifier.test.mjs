import assert from 'node:assert/strict'
import test from 'node:test'
import { createNotifier } from '../../lib/secretary/notifier.js'

const noopLogger = { warn: () => {} }

test('lifecycle 前缀 label 并同时投控制聊天与系统通道', async () => {
  const sent = []
  const system = []
  const notifier = createNotifier({
    control: () => ({ channel: { send: async (_, text) => sent.push(text) }, chatId: 'u1' }),
    system: { send: async payload => system.push(payload) },
    labelOf: async () => '【proj1·修 bug】',
    logger: noopLogger,
  })
  await notifier.lifecycle('s1', '回合完成', '✅ 会话回合完成：搞定')
  assert.deepEqual(sent, ['【proj1·修 bug】✅ 会话回合完成：搞定'])
  assert.deepEqual(system, [{ title: '回合完成', body: '【proj1·修 bug】✅ 会话回合完成：搞定' }])
})

test('无控制聊天时只走系统通道；label 失败退回原文', async () => {
  const system = []
  const notifier = createNotifier({
    control: () => null,
    system: { send: async payload => system.push(payload) },
    labelOf: async () => { throw new Error('list down') },
    logger: noopLogger,
  })
  await notifier.lifecycle('s1', '任务出错', '❌ 会话出错：boom')
  assert.deepEqual(system, [{ title: '任务出错', body: '❌ 会话出错：boom' }])
})

test('dispatchForward 投正文到控制聊天；channel.send 抛错只告警不抛出', async () => {
  const sent = []
  const notifier = createNotifier({
    control: () => ({ channel: { send: async (_, text) => { if (text.includes('bad')) throw new Error('down'); sent.push(text) } }, chatId: 'u1' }),
    labelOf: async () => '',
    logger: noopLogger,
  })
  await notifier.dispatchForward({ sessionId: 's1', tag: '0000', title: '需要你回答', body: '正文' })
  await notifier.dispatchForward({ sessionId: 's1', tag: '0001', title: '需要你回答', body: 'bad' })
  assert.deepEqual(sent, ['正文'])
})
