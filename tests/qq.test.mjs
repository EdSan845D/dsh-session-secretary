import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanQqText, createQqChannel, extractQqQuote } from '../lib/channels/qq.js'
import { parseQqQrSuccess } from '../lib/channels/qr/qq.js'
import { beginQqQr } from '../lib/channels/qr/qq.js'

const waitForImmediate = () => new Promise((resolve) => setImmediate(resolve))

test('QQ 文本去掉官方 @ 标记', () => {
  assert.equal(cleanQqText('<@!123> 你好'), '你好')
  assert.equal(cleanQqText('@机器人 继续'), '继续')
  assert.equal(cleanQqText('<@!123> A\r\nB\rC'), 'A\nB\nC')
})

test('QQ 提取 msg_elements 引用消息', () => {
  assert.equal(extractQqQuote(undefined), '')
  assert.equal(extractQqQuote([]), '')

  // 单条文本引用
  const quote1 = extractQqQuote([
    {
      author: { username: '小华' },
      content: '昨天的方案已经确认了',
    },
  ])
  assert.equal(quote1, '[引用 小华: 昨天的方案已经确认了]')

  // 多行文本引用
  const quoteMultiLine = extractQqQuote([
    {
      author: { username: '小张' },
      content: '第一行\n第二行',
    },
  ])
  assert.equal(quoteMultiLine, '[引用 小张: 第一行\n第二行]')

  // 附件类型引用
  const quoteAttach = extractQqQuote([
    {
      author: { username: '小李' },
      attachments: [{ content_type: 'image/png' }],
    },
  ])
  assert.equal(quoteAttach, '[引用 小李: [图片]]')

  // 纯引用（无额外作者前缀）
  const officialExample = extractQqQuote([
    {
      content: '今天的学习计划已完成',
    },
  ])
  assert.equal(officialExample, '[引用: 今天的学习计划已完成]')
})

test('QQ 引用模板只保留直接引用正文，不展开历史引用', () => {
  // 按真机截图重建的文本，不声称是捕获的原始事件。
  const content = [
    '=== 消息 1 ===',
    '[消息内容] 我也是',
    '',
    '[消息类型] 引用消息',
    '[关联消息]',
    '--- 第1条 ---',
    '    [消息内容] 你是坏蛋',
    '    [消息类型] 引用消息',
    '    [关联消息]',
    '    --- 第1条 ---',
    '        [消息内容] 我是大好人',
    '        [消息类型] 引用消息',
  ].join('\n')
  assert.equal(extractQqQuote([{ content }]), '[引用: 我也是]')
})

test('QQ 结构化引用不遍历历史链，直接正文保留多行和提及', () => {
  const history = { content: '不应出现的历史' }
  // 循环只用于证明提取函数不读取历史节点，不代表平台会发送循环 JSON。
  history.msg_elements = [history]
  assert.equal(extractQqQuote([{
    author: { username: '迷城' },
    content: '@小王 请确认\n第二行',
    msg_elements: [history],
  }]), '[引用 迷城: @小王 请确认\n第二行]')
})

test('QQ 直接引用过长时明确截断，不让引用文本无限增长', () => {
  const quote = extractQqQuote([{ content: '长'.repeat(20000) }])
  assert.ok(quote.length <= 8000)
  assert.match(quote, /已截断/)
})

test('QQ 不把多条顶层消息的未知模板当成单条引用截掉', () => {
  const content = [
    '=== 消息 1 ===', '[消息内容] 第一条', '[消息类型] 引用消息',
    '[关联消息]', '--- 第1条 ---', '    [消息内容] 旧消息',
    '=== 消息 2 ===', '[消息内容] 第二条', '[消息类型] 引用消息',
  ].join('\n')
  assert.equal(extractQqQuote([{ content }]), `[引用: ${content}]`)
})

test('QQ 引用模板保留多行正文和代码，兼容 Windows 换行', () => {
  const body = '@小王 请看\n```ts\nconst value = 1\n```\n最后一行'
  const template = `=== 消息 1 ===\n[消息内容] ${body}\n[消息类型] 引用消息\n[关联消息]\n--- 第1条 ---\n    [消息内容] 历史`
  for (const content of [template, template.replaceAll('\n', String.fromCharCode(13) + '\n')]) {
    assert.equal(extractQqQuote([{ content }]), `[引用: ${body}]`)
  }
})

test('QQ 不完整模板和普通标签文本原样保留', () => {
  for (const content of [
    '[消息内容] 这就是正文\n[消息类型] 引用消息',
    '=== 消息 1 ===\n[消息内容] 不完整模板',
    '=== 消息 1 ===\n[消息内容] 类型未知\n[消息类型] 新类型',
    '@小王 请确认\n<@!123> 是原文中的提及',
  ]) assert.equal(extractQqQuote([{ content }]), `[引用: ${content}]`)
})

test('QQ 模板历史变长不改变直接引用输出', () => {
  const content = '=== 消息 1 ===\n[消息内容] 我也是\n[消息类型] 引用消息\n[关联消息]\n'
  assert.equal(extractQqQuote([{ content: content + '    [消息内容] 历史\n'.repeat(10000) }]), '[引用: 我也是]')
})

test('QQ 没有直接正文时只保留当前附件，不拿历史正文冒充直接引用', () => {
  assert.equal(extractQqQuote([{ msg_elements: [{ content: '历史' }] }]), '[引用: （无文字）]')
  assert.equal(extractQqQuote([{ attachments: [{ content_type: 'image/png' }], msg_elements: [{ content: '历史' }] }]), '[引用: [图片]]')
})

test('QQ 同层消息和元素数量受限，不按正文相等去重', () => {
  assert.equal(extractQqQuote([{ content: '相同' }, { content: '相同' }]), '[引用: 相同]\n\n[引用: 相同]')
  const quote = extractQqQuote(Array.from({ length: 1000 }, () => ({ content: '正文' })))
  assert.ok(quote.length <= 8000)
  assert.match(quote, /部分引用已省略/)
  const longBatch = extractQqQuote(Array.from({ length: 100 }, () => ({ content: '长'.repeat(200) })))
  assert.ok(longBatch.length <= 8000)
  assert.match(longBatch, /已截断/)
})

test('QQ 超长直接正文先识别模板再截断，不泄漏模板头', () => {
  for (const length of [15975, 20000]) {
    const content = `=== 消息 1 ===\n[消息内容] ${'甲'.repeat(length)}\n[消息类型] 引用消息\n[关联消息]\n--- 第1条 ---\n    [消息内容] 历史`
    const quote = extractQqQuote([{ content }])
    assert.ok(quote.length <= 8000)
    assert.match(quote, /已截断/)
    assert.doesNotMatch(quote, /=== 消息|\[消息内容\]|历史/)
  }
})

test('QQ 完整来源中的第二条顶层消息不能因扫描窗口而被丢掉', () => {
  const content = '=== 消息 1 ===\n[消息内容] 第一条\n[消息类型] 引用消息\n[关联消息]\n'
    + '    历史\n'.repeat(4000)
    + '=== 消息 2 ===\n[消息内容] 第二条\n[消息类型] 引用消息'
  assert.match(extractQqQuote([{ content }]), /=== 消息 1 ===/)
})

test('QQ 截断只裁正文，长度与元素双上限不破坏标签或丢失提示', () => {
  const closed = quote => {
    assert.ok(quote.length <= 8000)
    assert.ok(quote.split('\n').filter(Boolean).every(part => part.startsWith('[') && part.endsWith(']')))
    assert.match(quote, /已截断/)
  }
  const empty = Array.from({ length: 99 }, () => ({ msg_elements: [{ content: '历史' }] }))
  const overlap = extractQqQuote([...empty, { content: '甲'.repeat(7994) }, { content: '末条' }])
  closed(overlap)
  assert.match(overlap, /部分引用已省略/)
  for (const length of [7965, 7970, 7994]) {
    closed(extractQqQuote([{ content: '甲'.repeat(length) }, { author: { username: '乙'.repeat(80) }, content: '末条' }]))
  }
})

test('QQ 截断正文和作者名不切坏 emoji', () => {
  for (const padding of ['', '甲']) {
    const quote = extractQqQuote([{ author: { username: '甲'.repeat(79) + '😀' }, content: padding + '😀'.repeat(5000) }])
    assert.ok(quote.length <= 8000)
    assert.equal(quote.isWellFormed(), true)
    assert.match(quote, /已截断/)
  }
})

test('QQ 引用的正文、作者和附件名称统一换行，不删除合法提及', () => {
  assert.equal(extractQqQuote([{ content: '<@!bot> A\r\nB\rC' }]), '[引用: <@!bot> A\nB\nC]')
  assert.equal(extractQqQuote([{ author: { username: '小\r\n华' }, attachments: [{ filename: 'A\r\nB.txt' }] }]), '[引用 小\n华: [A\nB.txt]]')
})

test('QQ 空直接引用保留占位，有直接附件时优先附件，不读取历史', () => {
  const content = '=== 消息 1 ===\n[消息内容] \n[消息类型] 引用消息\n[关联消息]\n    [消息内容] 旧历史'
  assert.equal(extractQqQuote([{ content }]), '[引用: （无文字）]')
  assert.equal(extractQqQuote([{ content, attachments: [{ content_type: 'image/png' }] }]), '[引用: [图片]]')
  assert.equal(extractQqQuote([{ author: { username: '小华' }, content: ' ' }]), '[引用 小华: （无文字）]')
  const quote = extractQqQuote(Array.from({ length: 101 }, () => ({ msg_elements: [{ content: '旧历史' }] })))
  assert.ok(quote.startsWith('[引用: （无文字）]'))
  assert.ok(quote.length <= 8000)
  assert.match(quote, /部分引用已省略/)
  assert.doesNotMatch(quote, /旧历史/)
})

test('QQ Bot 解析带引用的消息与纯引用消息', async () => {
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
    if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 'test-token' })
    if (url.endsWith('/gateway')) return Response.json({ url: 'ws://qq.test' })
    return Response.json({})
  }
  globalThis.WebSocket = MockWebSocket

  const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
  channel.setMessageHandler((message) => received.push(message))
  try {
    await channel.start()

    // 1. 引用 + 正文
    socket.onmessage?.({
      data: JSON.stringify({
        op: 0,
        t: 'GROUP_AT_MESSAGE_CREATE',
        d: {
          id: 'group-msg-with-quote',
          content: '<@!bot> 这条呢',
          message_type: 103,
          group_openid: 'group-1',
          author: { member_openid: 'member-1', username: '提问者' },
          msg_elements: [
            {
              author: { username: '被引用者' },
              content: '原先的待办事项',
            },
          ],
        },
      }),
    })

    // 2. 纯引用，无正文（或仅空格）
    socket.onmessage?.({
      data: JSON.stringify({
        op: 0,
        t: 'C2C_MESSAGE_CREATE',
        d: {
          id: 'c2c-pure-quote',
          content: ' ',
          message_type: 103,
          author: { user_openid: 'user-2', username: '纯引用用户' },
          msg_elements: [
            {
              author: { username: '某人' },
              content: '这条消息请解释一下',
            },
          ],
        },
      }),
    })

    await waitForImmediate()
    assert.equal(received.length, 2)

    // 验证第 1 条：引用 + 正文拼接
    assert.equal(received[0].chatId, 'g:group-1')
    assert.equal(received[0].text, '[引用 被引用者: 原先的待办事项]\n\n这条呢')

    // 验证第 2 条：纯引用正常放行，且格式为 [引用 作者: 内容]
    assert.equal(received[1].chatId, 'user-2')
    assert.equal(received[1].text, '[引用 某人: 这条消息请解释一下]')
  } finally {
    await channel.stop()
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  }
})

test('QQ 扫码成功结果解析凭据并保留扫码用户作为所有者', () => {
  const ok = parseQqQrSuccess([{ appId: '1023', appSecret: 'sec', userOpenid: 'owner-1' }])
  assert.deepEqual(ok, { appId: '1023', appSecret: 'sec', ownerOpenId: 'owner-1' })
  assert.deepEqual(parseQqQrSuccess([{ appId: '1023', appSecret: 'sec' }]), { appId: '1023', appSecret: 'sec' })
  assert.equal(parseQqQrSuccess({ appId: 'x' }), undefined)
})

test('QQ 扫码包装器关闭控制台输出并带回二维码地址', async () => {
  let observed
  const begun = await beginQqQr(undefined, (callbacks, options) => {
    observed = { options }
    callbacks.onQrDisplayed('https://q.qq.com/qr/test')
    return () => {}
  })
  assert.equal(begun.qrUrl, 'https://q.qq.com/qr/test')
  assert.deepEqual(observed.options, {
    displayQrCodeToConsole: false,
    source: 'dsh-im-connect',
    signal: undefined,
  })
})

test('QQ Bot 按官方协议获取网关并在 Hello 后鉴权', async () => {
  const originalFetch = globalThis.fetch
  const originalWebSocket = globalThis.WebSocket
  const requests = []
  const sockets = []

  class MockWebSocket {
    sent = []
    constructor(url) { this.url = url; sockets.push(this) }
    send(data) { this.sent.push(JSON.parse(data)) }
    close() {}
  }

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, init })
    if (url === 'https://bots.qq.com/app/getAppAccessToken') return Response.json({ access_token: 'test-token' })
    if (url === 'https://api.sgroup.qq.com/gateway') return Response.json({ url: 'ws://qq.test' })
    throw new Error('unexpected URL: ' + url)
  }
  globalThis.WebSocket = MockWebSocket

  const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
  assert.ok(channel)
  try {
    await channel.start()
    sockets[0].onopen?.()
    sockets[0].onmessage?.({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } }) })
    assert.deepEqual(sockets[0].sent, [{
      op: 2,
      d: { token: 'QQBot test-token', intents: 1 << 25, shard: [0, 1] },
    }])
    assert.deepEqual(JSON.parse(requests[0].init.body), { appId: 'app', clientSecret: 'secret' })
  } finally {
    await channel.stop()
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  }
})

test('QQ Bot 映射私聊和群 @，并只在收尾发送一条回复', async () => {
  const originalFetch = globalThis.fetch
  const originalWebSocket = globalThis.WebSocket
  const received = []
  const posts = []
  let socket

  class MockWebSocket {
    constructor() { socket = this }
    send() {}
    close() {}
  }

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 'test-token' })
    if (url.endsWith('/gateway')) return Response.json({ url: 'ws://qq.test' })
    posts.push({ url, body: JSON.parse(String(init.body)) })
    return Response.json({})
  }
  globalThis.WebSocket = MockWebSocket

  const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
  channel.setMessageHandler((message) => received.push(message))
  try {
    await channel.start()
    socket.onmessage?.({
      data: JSON.stringify({
        op: 0,
        t: 'C2C_MESSAGE_CREATE',
        d: { id: 'c2c-message', content: 'hello', author: { user_openid: 'user-openid' } },
      }),
    })
    socket.onmessage?.({
      data: JSON.stringify({
        op: 0,
        t: 'GROUP_AT_MESSAGE_CREATE',
        d: {
          id: 'group-message',
          content: '<@!bot> world',
          group_openid: 'group-openid',
          author: { member_openid: 'member-openid', username: 'tester' },
        },
      }),
    })
    await waitForImmediate()
    assert.equal(received[0].kind, 'dm')
    assert.equal(received[0].addressed, true)
    assert.equal(received[1].kind, 'group')
    assert.equal(received[1].chatId, 'g:group-openid')
    assert.equal(received[1].text, 'world')
    const stream = await channel.beginReply('user-openid')
    await stream.update('你')
    await stream.update('你好')
    await stream.finish('完整答案')
    assert.equal(posts.length, 1)
    assert.match(posts[0].url, /\/v2\/users\/user-openid\/messages/)
    assert.equal(posts[0].body.markdown.content, '完整答案')
    assert.equal(posts[0].body.msg_type, 2)
    assert.equal(posts[0].body.msg_id, 'c2c-message')
  } finally {
    await channel.stop()
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  }
})

test('QQ 群 chatId 自带 g: 前缀，渠道重启丢内存后仍路由到群接口', async () => {
  const originalFetch = globalThis.fetch
  const posts = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 't', expires_in: 7200 })
    posts.push({ url, body: JSON.parse(String(init.body)) })
    return Response.json({})
  }
  try {
    // 不经过任何入站消息直接发送，模拟 targets 内存丢失后的场景
    const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
    await channel.send('g:group-openid', '答案')
    assert.equal(posts.length, 1)
    assert.match(posts[0].url, /\/v2\/groups\/group-openid\/messages$/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('QQ AccessToken 到期后自动刷新，不依赖断线重连', async () => {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  const tokens = []
  const posts = []
  let fakeNow = 1_000_000

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/app/getAppAccessToken')) {
      tokens.push(JSON.parse(String(init.body)))
      return Response.json({ access_token: `token-${tokens.length}`, expires_in: 7200 })
    }
    posts.push({ url, auth: init.headers.Authorization })
    return Response.json({})
  }
  Date.now = () => fakeNow
  try {
    const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
    await channel.send('user-1', '第一条')
    fakeNow += 7200 * 1000
    await channel.send('user-1', '第二条')
    assert.equal(tokens.length, 2)
    assert.equal(posts[0].auth, 'QQBot token-1')
    assert.equal(posts[1].auth, 'QQBot token-2')
    await channel.stop()
  } finally {
    Date.now = originalNow
    globalThis.fetch = originalFetch
  }
})

test('QQ 收到网关 Reconnect(op 7) 时主动断开旧连接', async () => {
  const originalFetch = globalThis.fetch
  const originalWebSocket = globalThis.WebSocket
  let socket

  class MockWebSocket {
    closed = false
    constructor() { socket = this }
    send() {}
    close() { this.closed = true }
  }
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 't', expires_in: 7200 })
    if (url.endsWith('/gateway')) return Response.json({ url: 'ws://qq.test' })
    throw new Error('unexpected URL: ' + url)
  }
  globalThis.WebSocket = MockWebSocket
  try {
    const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
    await channel.start()
    assert.equal(socket.closed, false)
    socket.onmessage?.({ data: JSON.stringify({ op: 7 }) })
    assert.equal(socket.closed, true)
    await channel.stop()
  } finally {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  }
})

test('QQ 收到 401 时清缓存重取 token 并重试一次', async () => {
  const originalFetch = globalThis.fetch
  const tokens = []
  const posts = []
  let postCalls = 0

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/app/getAppAccessToken')) {
      tokens.push(JSON.parse(String(init.body)))
      return Response.json({ access_token: `token-${tokens.length}`, expires_in: 7200 })
    }
    postCalls += 1
    posts.push({ url, auth: init.headers.Authorization })
    if (postCalls === 1) return new Response('{"code":4004}', { status: 401 })
    return Response.json({})
  }
  try {
    const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
    await channel.send('user-1', '答案')
    assert.equal(tokens.length, 2)
    assert.equal(posts.length, 2)
    assert.equal(posts[0].auth, 'QQBot token-1')
    assert.equal(posts[1].auth, 'QQBot token-2')
    await channel.stop()
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('QQ 文件缺少下载地址时明确失败，不静默丢弃', async () => {
  const originalFetch = globalThis.fetch
  const originalWebSocket = globalThis.WebSocket
  const posts = []
  let socket

  class MockWebSocket {
    constructor() { socket = this }
    send() {}
    close() {}
  }
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 't', expires_in: 7200 })
    if (url.endsWith('/gateway')) return Response.json({ url: 'ws://qq.test' })
    posts.push({ url, body: JSON.parse(String(init.body)) })
    return Response.json({})
  }
  globalThis.WebSocket = MockWebSocket
  try {
    const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
    await channel.start()
    socket.onmessage?.({
      data: JSON.stringify({
        op: 0,
        t: 'GROUP_AT_MESSAGE_CREATE',
        d: {
          id: 'media-message',
          group_openid: 'group-openid',
          attachments: [{ content_type: 'application/pdf' }],
          author: { member_openid: 'member-openid', username: 'tester' },
        },
      }),
    })
    await waitForImmediate()
    assert.equal(posts.length, 1)
    assert.match(posts[0].url, /\/v2\/groups\/group-openid\/messages$/)
    assert.match(posts[0].body.markdown.content, /失败/)
    assert.equal(posts[0].body.msg_id, 'media-message')
    await channel.stop()
  } finally {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  }
})

test('QQ 二维码过期后继续等待刷新，不结束配对', async () => {
  let callbacks
  const begun = await beginQqQr(undefined, (next, options) => {
    callbacks = next
    next.onQrDisplayed('https://q.qq.com/qr/old')
    return () => {}
  })
  callbacks.onQrExpired()
  const refreshing = await begun.poll()
  assert.equal(refreshing.status, 'waiting')
  callbacks.onQrDisplayed('https://q.qq.com/qr/new')
  const refreshed = await begun.poll()
  assert.equal(refreshed.status, 'waiting')
  assert.equal(refreshed.qrUrl, 'https://q.qq.com/qr/new')
})

test('QQ 出站：含 markdown 的回复按官方协议走 msg_type=2，表格保持原样', async () => {
  const originalFetch = globalThis.fetch
  const posts = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 't', expires_in: 7200 })
    posts.push({ url, body: JSON.parse(String(init.body)) })
    return Response.json({})
  }
  try {
    const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
    await channel.send('user-1', '**加粗**\n\n| name | value |\n|---|---|\n| alpha | 1 |')
    assert.equal(posts.length, 1)
    assert.equal(posts[0].body.msg_type, 2)
    assert.match(posts[0].body.markdown.content, /\*\*加粗\*\*/)
    assert.match(posts[0].body.markdown.content, /\| alpha \| 1 \|/)
    assert.equal(posts[0].body.content, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('QQ 出站：纯文本也走 msg_type=2，不因没有标记改回纯文本', async () => {
  const originalFetch = globalThis.fetch
  const posts = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 't', expires_in: 7200 })
    posts.push({ url, body: JSON.parse(String(init.body)) })
    return Response.json({})
  }
  try {
    const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
    await channel.send('user-1', '今天已推送，仅供参考')
    assert.equal(posts.length, 1)
    assert.equal(posts[0].body.msg_type, 2)
    assert.equal(posts[0].body.markdown.content, '今天已推送，仅供参考')
    assert.equal(posts[0].body.content, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('QQ 出站：50056 回退纯文本并递增 msg_seq，之后不再尝试 markdown', async () => {
  const originalFetch = globalThis.fetch
  const posts = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 't', expires_in: 7200 })
    const body = JSON.parse(String(init.body))
    posts.push({ url, body })
    if (body.msg_type === 2) return Response.json({ err_code: 50056, message: '不允许发送 markdown content' }, { status: 400 })
    return Response.json({})
  }
  try {
    const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
    await channel.send('user-1', '**加粗**')
    await channel.send('user-1', '**再次**')
    assert.equal(posts.length, 3)
    assert.equal(posts[0].body.msg_type, 2)
    assert.equal(posts[1].body.msg_type, 0)
    assert.equal(posts[1].body.content, '加粗')
    assert.equal(posts[1].body.msg_seq, posts[0].body.msg_seq + 1)
    assert.equal(posts[2].body.msg_type, 0)
    assert.equal(posts[2].body.content, '再次')
    assert.equal(posts[2].body.msg_seq, posts[1].body.msg_seq + 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('QQ 出站：没有 err_code 的 HTTP 错误不回退', async () => {
  const originalFetch = globalThis.fetch
  const posts = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 't', expires_in: 7200 })
    posts.push({ url, body: JSON.parse(String(init.body)) })
    return new Response('markdown not allowed', { status: 400 })
  }
  try {
    const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
    await assert.rejects(channel.send('user-1', '**加粗**'), /HTTP 400/)
    assert.equal(posts.length, 1)
    assert.equal(posts[0].body.msg_type, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('QQ 出站：超时不回退，避免「消息其实已送达却被重发」', async () => {
  const originalFetch = globalThis.fetch
  const posts = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 't', expires_in: 7200 })
    posts.push({ url, body: JSON.parse(String(init.body)) })
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  }
  try {
    const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
    await assert.rejects(channel.send('user-1', '**加粗**'), /timeout/i)
    assert.equal(posts.length, 1)
    assert.equal(posts[0].body.msg_type, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('QQ 出站：网络错误不回退，避免「消息其实已送达却被重发」', async () => {
  const originalFetch = globalThis.fetch
  const posts = []

  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: 't', expires_in: 7200 })
    posts.push({ url, body: JSON.parse(String(init.body)) })
    throw new TypeError('fetch failed')
  }
  try {
    const channel = createQqChannel({ appId: 'app', appSecret: 'secret' }, () => {})
    await assert.rejects(channel.send('user-1', '**加粗**'), /fetch failed/)
    assert.equal(posts.length, 1)
    assert.equal(posts[0].body.msg_type, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})
