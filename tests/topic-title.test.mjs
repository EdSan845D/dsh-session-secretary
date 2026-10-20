import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TopicTitleStore, clampTopicName } from '../lib/engine/topic-title.js'
import { createTelegramChannel } from '../lib/channels/telegram.js'

const CHAT = '1081564546:143430'
const KEY = `telegram_1:${CHAT}`

test('默认 once：新话题写一次，之后标题再变也不跟随', () => {
  const store = new TopicTitleStore(undefined)
  assert.equal(store.canWrite(KEY, 'once'), true, '新话题应当允许命名')

  store.rememberWritten(KEY, '第一条标题')
  assert.equal(store.canWrite(KEY, 'once'), false, '命名过之后不再自动改名')

  // 标题变了也不该再写（避开 editForumTopic 频控与话题名跳动）
  store.rememberWritten(KEY, '后来的标题')
  assert.equal(store.status(KEY).name, '后来的标题')
})

test('once 模式下同名不重复写，且已命名话题可被 /rename 显式覆盖', () => {
  const store = new TopicTitleStore(undefined)
  store.rememberWritten(KEY, '原话题名')
  assert.equal(store.canWrite(KEY, 'once'), false)
  // 显式改名由调用方绕过 canWrite，直接 rememberWritten
  store.rememberWritten(KEY, '人工改名')
  assert.equal(store.status(KEY).name, '人工改名')
})

test('off 模式完全关闭自动命名', () => {
  const store = new TopicTitleStore(undefined)
  assert.equal(store.canWrite(KEY, 'off'), false)
})

test('follow 模式仍然跟随最新', () => {
  const store = new TopicTitleStore(undefined)
  store.rememberWritten(KEY, '标题一', true)
  assert.equal(store.canWrite(KEY, 'follow'), true)
  store.rememberWritten(KEY, '标题二', true)
  assert.equal(store.status(KEY).name, '标题二')
})

test('人工改名（forum_topic_edited）锁定后任何模式都不再写', () => {
  const store = new TopicTitleStore(undefined)
  store.rememberWritten(KEY, '自动标题', true)
  assert.equal(store.observeEdit(KEY, '自动标题'), 'self', '自己写入的回显不应算人工改名')
  assert.equal(store.observeEdit(KEY, '我手动改的名字'), 'frozen')
  assert.equal(store.status(KEY).frozen, true)
  for (const mode of ['once', 'follow', 'off']) {
    assert.equal(store.canWrite(KEY, mode), false)
  }
})

test('锁定与命名状态跨重启保持', () => {
  const dir = mkdtempSync(join(tmpdir(), 'topic-title-'))
  try {
    const file = join(dir, 'topic-titles.json')
    const first = new TopicTitleStore(file)
    first.rememberWritten(KEY, '定下来的名字')
    first.freeze(KEY, '定下来的名字')

    const reopened = new TopicTitleStore(file)
    assert.deepEqual(reopened.status(KEY), { name: '定下来的名字', named: true, frozen: true })
    assert.equal(reopened.canWrite(KEY, 'follow'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unfreeze 在 once 模式下让话题可以重新命名', () => {
  const store = new TopicTitleStore(undefined)
  store.rememberWritten(KEY, '旧名字')
  store.freeze(KEY, '旧名字')
  assert.equal(store.canWrite(KEY, 'once'), false)

  store.unfreeze(KEY, 'once')
  assert.equal(store.canWrite(KEY, 'once'), true, '解锁后应能重新命名')
  assert.equal(store.status(KEY).name, undefined, '旧名字要清掉，否则同名会被跳过')
})

test('话题名按码点截断到 128，不切碎 emoji 代理对', () => {
  assert.equal(clampTopicName('  Telegram 话题  '), 'Telegram 话题')
  assert.equal(clampTopicName('   '), undefined)
  assert.equal(clampTopicName(undefined), undefined)
  // 控制字符要清掉，否则话题名会带不可见内容
  assert.equal(clampTopicName('a\u0000b\nc'), 'a b c')

  const long = clampTopicName('字'.repeat(200))
  assert.equal([...long].length, 128)
  assert.ok(long.endsWith('…'))

  // 代理对：按 UTF-16 slice 会切出孤立代理，这里必须保持完整
  const emoji = clampTopicName('a😀'.repeat(100))
  assert.equal([...emoji].length, 128)
  assert.ok(!/[\uD800-\uDBFF]$/.test(emoji), '不能以孤立代理结尾')
})

test('适配器：普通聊天没有话题名，直接跳过不调接口', async () => {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return { json: async () => ({ ok: true, result: true }) }
  }
  try {
    const adapter = createTelegramChannel({ token: '123:abc' }, () => {})
    assert.equal(await adapter.renameTopic('1081564546', '普通私聊'), false)
    assert.equal(calls.length, 0, '没有 threadId 就不该请求 Telegram')
  } finally {
    globalThis.fetch = original
  }
})

test('适配器：有话题时按 message_thread_id 调用 editForumTopic', async () => {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return { json: async () => ({ ok: true, result: true }) }
  }
  try {
    const adapter = createTelegramChannel({ token: '123:abc' }, () => {})
    assert.equal(await adapter.renameTopic(CHAT, 'Telegram 话题自动命名'), true)
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /\/editForumTopic$/)
    assert.deepEqual(calls[0].body, {
      chat_id: 1081564546,
      message_thread_id: 143430,
      name: 'Telegram 话题自动命名',
    })
  } finally {
    globalThis.fetch = original
  }
})

test('适配器：频控 429 不抛错，返回 false 交给下轮重试', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    json: async () => ({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 30' }),
  })
  try {
    const adapter = createTelegramChannel({ token: '123:abc' }, () => {})
    assert.equal(await adapter.renameTopic(CHAT, '频控测试'), false)
  } finally {
    globalThis.fetch = original
  }
})

test('适配器：forum_topic_edited 只上报，不产生对话回合', async () => {
  let edited
  const messages = []
  let polls = 0
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('getUpdates')) {
      polls += 1
      const result = polls === 1
        ? [{
            update_id: 1,
            message: {
              message_id: 10,
              message_thread_id: 143430,
              date: 1,
              chat: { id: 1081564546, type: 'private' },
              from: { id: 1081564546, first_name: 'Siiloo' },
              forum_topic_edited: { name: '我手动改的名字' },
            },
          }]
        : []
      if (polls > 3) throw new Error('停止轮询')
      return { json: async () => ({ ok: true, result }) }
    }
    if (String(url).includes('getMe')) return { json: async () => ({ ok: true, result: { id: 1, is_bot: true } }) }
    if (String(url).includes('getWebhookInfo')) return { json: async () => ({ ok: true, result: {} }) }
    return { json: async () => ({ ok: true, result: true }) }
  }
  try {
    const adapter = createTelegramChannel({ token: '123:abc' }, () => {})
    adapter.setMessageHandler((msg) => messages.push(msg))
    adapter.setTopicEditHandler((chatId, name) => { edited = { chatId, name } })
    await adapter.start()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await adapter.stop()

    assert.deepEqual(edited, { chatId: CHAT, name: '我手动改的名字' })
    assert.equal(messages.length, 0, '改名服务消息不能送进 agent')
  } finally {
    globalThis.fetch = original
  }
})
