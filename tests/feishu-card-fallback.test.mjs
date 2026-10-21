import assert from 'node:assert/strict'
import test from 'node:test'
import * as realSdk from '@larksuiteoapi/node-sdk'
import { createFeishuChannel, splitByTableLimit } from '../lib/channels/feishu.js'
import { DeliveryRejected } from '../lib/engine/deferred-delivery.js'

function httpError(status, code) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { code } },
  })
}

// 保留真实 SDK 的请求构造与异常传播，仅替换 HTTP 传输和长连接，避免访问真实账号。
async function channelWithTransport(t, id, respond) {
  const calls = []
  const transport = { request: async opts => {
    if (opts.url.includes('auth/v3')) return { code: 0, tenant_access_token: 'test', app_access_token: 'test', expire: 7200 }
    if (opts.url.includes('/bot/v3/info')) return { bot: { open_id: 'test' } }
    assert.ok(opts.url.includes('/im/v1/messages'), '只允许预期的消息接口')
    const data = typeof opts.data === 'string' ? JSON.parse(opts.data) : opts.data
    calls.push(data)
    return respond(data, calls.length)
  } }
  transport.post = (url, data) => transport.request({ url, data })
  const sdk = { ...realSdk, defaultHttpInstance: transport,
    EventDispatcher: class { register() { return this } }, WSClient: class { async start() {} close() {} } }
  const channel = createFeishuChannel(id, { appId: `card-fallback-${id}`, appSecret: 'test' }, () => {}, async () => sdk)
  t.after(() => channel.stop())
  await channel.start()
  return { channel, calls }
}

for (const id of ['feishu', 'lark']) test(`${id} 卡片 HTTP 400 后只回退一次纯文本并保留图片路径与完整正文`, async t => {
  const text = '### 结果\n\n截图如下：\n![Ch2 冷开场](temp/ch02-film/render/ch02-f02.png)\n\n正文末尾。'
  const { channel, calls } = await channelWithTransport(t, id, data => {
    if (data.msg_type === 'interactive') throw httpError(400)
    return { code: 0, data: { message_id: 'plain-message' } }
  })
  await channel.send('chat', text)
  assert.deepEqual(calls.map(data => data.msg_type), ['interactive', 'text'])
  const card = JSON.parse(calls[0].content)
  assert.equal(card.schema, '2.0')
  assert.equal(card.body.elements[0].content, text)
  assert.equal(JSON.parse(calls[1].content).text, text)
  assert.ok(calls.every(data => data.receive_id === 'chat'))
})

for (const id of ['feishu', 'lark']) {
  for (const [status, code] of [[429, undefined], [400, 230020], [400, 11232], [400, 99991400], [400, '99991400']]) {
    test(`${id} HTTP ${status} 限流码 ${code} 不回退纯文本`, async t => {
      const { channel, calls } = await channelWithTransport(t, id, () => { throw httpError(status, code) })
      await assert.rejects(channel.send('chat', '正文'), error => error instanceof DeliveryRejected)
      assert.deepEqual(calls.map(data => data.msg_type), ['interactive'])
    })
  }

  for (const error of [httpError(401), httpError(403), httpError(404), httpError(408), httpError(500), httpError(503),
    new Error('请求超时'), new Error('接收后连接断开')]) {
    test(`${id} ${error.message} 保留原异常且不重复发送`, async t => {
      const { channel, calls } = await channelWithTransport(t, id, () => { throw error })
      await assert.rejects(channel.send('chat', '正文'), actual => actual === error)
      assert.deepEqual(calls.map(data => data.msg_type), ['interactive'])
    })
  }

  for (const mode of ['http-400', 'http-429', 'business', 'business-throttle']) {
    test(`${id} 卡片 HTTP 400 后纯文本失败继续向上报告：${mode}`, async t => {
      const error = httpError(mode === 'http-429' ? 429 : 400)
      const { channel, calls } = await channelWithTransport(t, id, data => {
        if (data.msg_type === 'interactive') throw httpError(400, 230099)
        if (mode === 'business') return { code: 230001 }
        if (mode === 'business-throttle') return { code: 230020 }
        throw error
      })
      await assert.rejects(channel.send('chat', '正文'), actual => {
        if (mode === 'http-429' || mode === 'business-throttle') return actual instanceof DeliveryRejected
        if (mode === 'business') return !(actual instanceof DeliveryRejected) && /230001/.test(actual.message)
        return actual === error
      })
      assert.deepEqual(calls.map(data => data.msg_type), ['interactive', 'text'], '回退失败不能再次降级或重发')
    })
  }

  for (const plainThrottled of [false, true]) {
    test(`${id} 后续卡片 HTTP 400 仅回退当前分片：纯文本限流=${plainThrottled}`, async t => {
      const text = Array.from({ length: 6 }, (_, n) => `第 ${n} 段\n\n| 列 | 值 |\n| --- | --- |\n| ${n} | x |`).join('\n\n')
      const parts = splitByTableLimit(text)
      assert.equal(parts.length, 2)
      const { channel, calls } = await channelWithTransport(t, id, (data, count) => {
        if (count === 1) return { code: 0 }
        if (data.msg_type === 'interactive') throw httpError(400)
        if (plainThrottled) throw httpError(429)
        return { code: 0 }
      })
      if (plainThrottled) {
        await assert.rejects(channel.send('chat', text), error =>
          !(error instanceof DeliveryRejected) && error.cause instanceof DeliveryRejected)
      } else await channel.send('chat', text)
      assert.deepEqual(calls.map(data => data.msg_type), ['interactive', 'interactive', 'text'])
      assert.equal(JSON.parse(calls[0].content).body.elements[0].content, parts[0])
      assert.equal(JSON.parse(calls[1].content).body.elements[0].content, parts[1])
      assert.equal(JSON.parse(calls[2].content).text, parts[1], '不能重发已成功的前一分片')
    })
  }
}
