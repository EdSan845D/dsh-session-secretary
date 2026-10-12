// QQ WS 入站 → 生产引擎授权/合并/路由 → 宿主 Agent followup。
// 仅替换平台网络与宿主入口，不连接真实账号或调用模型。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createQqChannel } from '../lib/channels/qq.js'
import { ImEngine } from '../lib/engine/gateway.js'
import { SessionMapStore } from '../lib/engine/session-store.js'
import { SeenStore } from '../lib/engine/seen-store.js'

async function waitFor(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('QQ 端到端测试等待超时')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

for (const event of ['GROUP_AT_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE']) {
  test(`QQ ${event} 仅直接引用正文经过生产路由进入宿主 Agent`, async (t) => {
    const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'im-qq-e2e-'))
    const group = event === 'GROUP_AT_MESSAGE_CREATE'
    const kind = group ? 'group' : 'dm'
    const chatId = group ? 'g:group-qq-1' : 'user-qq-1'
    const sessionId = `qq-reference-${kind}`
    const file = join(dir, 'sessions.json')
    const originalFetch = globalThis.fetch
    const originalWebSocket = globalThis.WebSocket

    const received = []
    let socket

    class MockWebSocket {
      constructor(url) {
        socket = this
        this.url = url
        setTimeout(() => {
          this.onopen?.()
          this.onmessage?.({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }) })
        }, 0)
      }
      send() {}
      close() {}
    }

    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 'test-token', expires_in: 7200 })
      if (url.endsWith('/gateway')) return Response.json({ url: 'ws://qq.test' })
      return Response.json({})
    }
    globalThis.WebSocket = MockWebSocket

    const ctx = new Context()
    ctx.provide('agents')
    ctx.provide('sessionController')
    ctx.provide('workspaceRegistry')
    ctx.provide('workspaceController')
    ctx.set('agents', { get: id => id === sessionId ? ({ followup: message => received.push(message) }) : undefined })
    ctx.set('sessionController', {
      async prompt() {
        assert.fail('纯文本引用应走 Agent followup，不走图片 admission')
      },
    })
    ctx.set('workspaceRegistry', { list: () => [{ path: dir, async attachSession() {} }], archivedSessionIds: [] })
    ctx.set('workspaceController', { async *follow() { yield { value: { items: [{ workspaceId: 'w', path: dir, sessionIds: [] }] } } } })

    const store = new SessionMapStore(file)
    store.upsert(`qq:${kind}:${chatId}`, { sessionId, channel: 'qq', kind, chatId, title: '引用测试', cwd: dir, updatedAt: new Date().toISOString() })
    const engine = new ImEngine(ctx, store, new SeenStore(join(dir, 'seen.json')), { cwd: dir, provider: 'p', model: 'm', mergeTimeoutSecs: 1 }, () => {})
    const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
    engine.register(channel)
    engine.addAllowed('qq', 'user-qq-1')

    try {
      await channel.start()
      await engine.router.attachMappedSessions()

      // 保留 engine.register 设置的生产 handler，不绕过引擎。

      // 模拟引用历史链后发送当前正文，群聊和私聊使用同一生产链路。
      socket.onmessage?.({
        data: JSON.stringify({
          op: 0,
          t: event,
          d: {
            id: 'qq-msg-101',
            content: '<@!bot> 在测试一下',
            message_type: 103,
            ...(group ? { group_openid: 'group-qq-1' } : {}),
            author: group ? { member_openid: 'user-qq-1' } : { user_openid: 'user-qq-1' },
            msg_elements: [
              {
                // 截图文本重建，不是捕获的真实事件。
                content: '=== 消息 1 ===\n[消息内容] 我也是\n\n[消息类型] 引用消息\n[关联消息]\n--- 第1条 ---\n    [消息内容] 你是坏蛋\n    [消息类型] 引用消息\n    [关联消息]\n    --- 第1条 ---\n        [消息内容] 我是大好人\n        [消息类型] 引用消息',
                msg_elements: [{ content: '不应出现的历史' }],
              },
            ],
          },
        }),
      })

      await waitFor(() => received.length > 0)
      assert.equal(received.length, 1)
      assert.equal(received[0].role, 'user')
      assert.deepEqual(received[0].content, [{ type: 'text', text: '[引用: 我也是]\n\n在测试一下' }])
      assert.equal(engine.router.lookup('qq', kind, chatId)?.sessionId, sessionId)
    } finally {
      engine.dispose()
      await channel.stop()
      await engine.router.disposeAll()
      globalThis.fetch = originalFetch
      globalThis.WebSocket = originalWebSocket
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
