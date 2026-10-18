import assert from 'node:assert/strict'
import test from 'node:test'
import {
  telegramChatId,
  parseTelegramChatId,
  createTelegramChannel,
} from '../lib/channels/telegram.js'

function mockFetch(handler) {
  const previous = globalThis.fetch
  globalThis.fetch = handler
  return () => { globalThis.fetch = previous }
}

test('telegramChatId 和 parseTelegramChatId 编解码及向后兼容', () => {
  assert.equal(telegramChatId(123), '123')
  assert.equal(telegramChatId('123'), '123')
  assert.equal(telegramChatId(-100123456789), '-100123456789')
  assert.equal(telegramChatId(-100123456789, 42), '-100123456789:42')
  assert.equal(telegramChatId('123', undefined), '123')

  assert.deepEqual(parseTelegramChatId('123'), { chatId: 123, threadId: undefined })
  assert.deepEqual(parseTelegramChatId('-100123456789'), { chatId: -100123456789, threadId: undefined })
  assert.deepEqual(parseTelegramChatId('-100123456789:42'), { chatId: -100123456789, threadId: 42 })
})

test('Telegram 话题入站携带 message_thread_id 并在 chatId 隔离', async () => {
  let pollCount = 0
  const restore = mockFetch(async (url, init) => {
    const method = String(url).split('/').pop()
    if (method === 'getMe') return { json: async () => ({ ok: true, result: { id: 99, username: 'test_bot', is_bot: true } }) }
    if (method === 'getWebhookInfo') return { json: async () => ({ ok: true, result: { url: '' } }) }
    if (method === 'getUpdates' && pollCount++ === 0) {
      return {
        json: async () => ({
          ok: true,
          result: [
            {
              update_id: 101,
              message: {
                message_id: 50,
                chat: { id: -1009999, type: 'supergroup' },
                from: { id: 777, username: 'bob' },
                text: '@test_bot hello topic',
                message_thread_id: 888,
                is_topic_message: true,
                entities: [{ type: 'mention', offset: 0, length: 9 }],
              },
            },
            {
              update_id: 102,
              callback_query: {
                id: 'cb-1',
                data: 'action-select',
                from: { id: 777 },
                message: {
                  message_id: 51,
                  chat: { id: -1009999, type: 'supergroup' },
                  message_thread_id: 888,
                  is_topic_message: true,
                },
              },
            },
          ],
        }),
      }
    }
    if (method === 'answerCallbackQuery') return { json: async () => ({ ok: true, result: true }) }
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    })
  })

  try {
    const channel = createTelegramChannel({ token: 'test-token' }, () => undefined)
    assert.ok(channel)
    const received = []
    channel.setMessageHandler((msg) => { received.push(msg) })
    await channel.start()
    for (let i = 0; i < 20 && received.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(received.length, 2)
    assert.equal(received[0].chatId, '-1009999:888')
    assert.equal(received[0].userId, '777')
    assert.equal(received[0].text, 'hello topic')

    assert.equal(received[1].chatId, '-1009999:888')
    assert.equal(received[1].actionToken, 'action-select')
    await channel.stop()
  } finally {
    restore()
  }
})

test('Telegram 话题中各类出站请求带上 message_thread_id', async () => {
  const calls = []
  const restore = mockFetch(async (url, init) => {
    const method = String(url).split('/').pop()
    const body = init?.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : {}
    if (body?.rich_message) return { json: async () => ({ ok: false, error_code: 404, description: 'Not Found' }) }
    calls.push({ method, body, rawBody: init?.body })
    return { json: async () => ({ ok: true, result: { message_id: 1234 } }) }
  })

  try {
    const channel = createTelegramChannel({ token: 'test-token' }, () => undefined)
    const topicChatId = '-1009999:888'

    // 1. send
    await channel.send(topicChatId, '正文回复')
    const sendCall = calls.find((c) => c.method === 'sendMessage' && c.body?.text === '正文回复')
    assert.ok(sendCall)
    assert.equal(sendCall.body.chat_id, -1009999)
    assert.equal(sendCall.body.message_thread_id, 888)

    // 2. sendAction
    await channel.sendAction(topicChatId)
    const actionCall = calls.find((c) => c.method === 'sendChatAction')
    assert.ok(actionCall)
    assert.equal(actionCall.body.chat_id, -1009999)
    assert.equal(actionCall.body.message_thread_id, 888)

    // 3. sendChoices
    const choiceHandle = await channel.sendChoices({ chatId: topicChatId }, '选择题', [{ label: '选项A', token: 'a' }])
    const choicesCall = calls.find((c) => c.method === 'sendMessage' && c.body?.text === '选择题')
    assert.ok(choicesCall)
    assert.equal(choicesCall.body.chat_id, -1009999)
    assert.equal(choicesCall.body.message_thread_id, 888)

    // 3.1 close choices
    await choiceHandle.close('已选择A')
    const editChoiceCall = calls.find((c) => c.method === 'editMessageText' && c.body?.message_id === 1234)
    assert.ok(editChoiceCall)
    assert.equal(editChoiceCall.body.chat_id, -1009999)

    // 4. sendFile (FormData)
    await channel.sendFile(topicChatId, {
      name: 'test.txt',
      mimeType: 'text/plain',
      data: Buffer.from('hello file'),
    })
    const fileCall = calls.find((c) => c.method === 'sendDocument')
    assert.ok(fileCall)
    const form = fileCall.rawBody
    assert.equal(form.get('chat_id'), '-1009999')
    assert.equal(form.get('message_thread_id'), '888')

    // 5. beginReply (流式回复)
    const stream = await channel.beginReply(topicChatId)
    await stream.finish('流式完成')
    const placeholderCall = calls.find((c) => c.method === 'sendMessage' && c.body?.text === '…')
    assert.ok(placeholderCall)
    assert.equal(placeholderCall.body.chat_id, -1009999)
    assert.equal(placeholderCall.body.message_thread_id, 888)
  } finally {
    restore()
  }
})
