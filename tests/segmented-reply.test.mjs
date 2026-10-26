import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ImEngine } from '../lib/engine/gateway.js'
import { SessionMapStore } from '../lib/engine/session-store.js'
import { SeenStore } from '../lib/engine/seen-store.js'
import { randomSegmentDelay, splitSegments } from '../lib/engine/segments.js'

const MARKER = '<<<MSG>>>'

test('随机间隔取在闭区间内，上下界与固定值都成立', () => {
  assert.equal(randomSegmentDelay(1000, 3000, () => 0), 1000)
  assert.equal(randomSegmentDelay(1000, 3000, () => 0.999999), 3000)
  const middle = randomSegmentDelay(2000, 2000, () => 0.5)
  assert.equal(middle, 2000)
  for (const draw of [0, 0.1, 0.34, 0.5, 0.75, 0.999]) {
    const value = randomSegmentDelay(1000, 3000, () => draw)
    assert.ok(value >= 1000 && value <= 3000, `${draw} -> ${value}`)
    assert.equal(value % 1000, 0, '按整秒取值')
  }
})

test('按独占一行的标记切分段消息并去掉首尾空白', () => {
  const text = ['第一句', '', MARKER, '第二句', MARKER, '', '  第三句  '].join('\n')
  assert.deepEqual(splitSegments(text, MARKER), ['第一句', '第二句', '第三句'])
})

test('没有标记或标记只是正文一部分时保持一条', () => {
  assert.deepEqual(splitSegments('只有一句话', MARKER), ['只有一句话'])
  assert.deepEqual(splitSegments(`提到 ${MARKER} 但不在单独一行`, MARKER), [`提到 ${MARKER} 但不在单独一行`])
  assert.deepEqual(splitSegments('', MARKER), [])
})

test('围栏代码块里的标记不算分隔符，代码块不会被拆坏', () => {
  const text = ['说明', MARKER, '```js', `const sep = '${MARKER}'`, '```', MARKER, '结尾'].join('\n')
  assert.deepEqual(splitSegments(text, MARKER), ['说明', `\`\`\`js\nconst sep = '${MARKER}'\n\`\`\``, '结尾'])
})

test('空片被丢弃，连续标记不会产生空消息', () => {
  assert.deepEqual(splitSegments(`${MARKER}\n${MARKER}\n甲\n${MARKER}\n${MARKER}`, MARKER), ['甲'])
})

function makeEngine(t, config = {}, platform = 'qq') {
  const dir = mkdtempSync(join(tmpdir(), 'im-connect-segment-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new SessionMapStore(join(dir, 'sessions.json'))
  const sessionId = `im:${platform}:dm:1700000000000:user-1`
  store.upsert(`${platform}:dm:user-1`, {
    sessionId,
    channel: platform,
    kind: 'dm',
    chatId: 'user-1',
    title: '测试',
    updatedAt: '2026-08-17T00:00:00.000Z',
  })
  const handlers = {}
  const ctx = { on: (name, fn) => { handlers[name] = fn; return () => {} } }
  const engine = new ImEngine(ctx, store, new SeenStore(join(dir, 'seen.json')), {
    cwd: dir,
    provider: 'p',
    model: 'm',
    agentPreset: 'standard',
    mergeTimeoutSecs: 1,
    permissionPreset: 'danger-full-access',
    ...config,
  }, () => {})
  t.after(() => engine.dispose())
  return { engine, handlers, sessionId }
}

test('未开启分段回复时一条标记正文原样发出', async t => {
  const { engine, handlers, sessionId } = makeEngine(t)
  const sent = []
  engine.register({
    id: 'qq', label: 'QQ', maxMessageLength: 2000, start() {}, stop() {}, setMessageHandler() {}, status: () => 'connected',
    send: async (_, text) => { sent.push(text) },
  })
  handlers['session/event']({ id: sessionId }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `甲\n${MARKER}\n乙` }] } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, [`甲\n${MARKER}\n乙`])
})

test('开启分段回复后按标记逐条投递', async t => {
  const { engine, handlers, sessionId } = makeEngine(t, { segmentReply: true, segmentMarker: MARKER, segmentDelayMinSecs: 0, segmentDelayMaxSecs: 0 })
  const sent = []
  engine.register({
    id: 'qq', label: 'QQ', maxMessageLength: 2000, start() {}, stop() {}, setMessageHandler() {}, status: () => 'connected',
    send: async (_, text) => { sent.push(text) },
  })
  handlers['session/event']({ id: sessionId }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `甲\n${MARKER}\n乙\n${MARKER}\n丙` }] } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, ['甲', '乙', '丙'])
})

test('开启分段回复后流式渠道首条走收口，其余逐条补发', async t => {
  const { engine, handlers, sessionId } = makeEngine(t, { segmentReply: true, segmentMarker: MARKER, segmentDelayMinSecs: 0, segmentDelayMaxSecs: 0 })
  const finished = []
  const sent = []
  engine.register({
    id: 'qq', label: 'QQ', maxMessageLength: 2000, start() {}, stop() {}, setMessageHandler() {}, status: () => 'connected',
    send: async (_, text) => { sent.push(text) },
    beginReply: async () => ({ update: async () => {}, finish: async text => { finished.push(text) } }),
  })
  handlers['session/event']({ id: sessionId }, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '甲' } } })
  handlers['session/event']({ id: sessionId }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `甲\n${MARKER}\n乙` }] } } })
  for (let index = 0; index < 20 && sent.length === 0; index += 1) await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(finished, ['甲'])
  assert.deepEqual(sent, ['乙'])
})

test('分段回复的第一条也要等一个随机间隔', async t => {
  // 区间固定 50ms，便于断言第一条不是立刻发出。
  const { engine, handlers, sessionId } = makeEngine(t, { segmentReply: true, segmentMarker: MARKER, segmentDelayMinSecs: 0.05, segmentDelayMaxSecs: 0.05 })
  const sent = []
  let firstAt = 0
  engine.register({
    id: 'qq', label: 'QQ', maxMessageLength: 2000, start() {}, stop() {}, setMessageHandler() {}, status: () => 'connected',
    send: async (_, text) => { if (firstAt === 0) firstAt = Date.now(); sent.push(text) },
  })
  const started = Date.now()
  handlers['session/event']({ id: sessionId }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `甲\n${MARKER}\n乙` }] } } })
  for (let index = 0; index < 100 && sent.length < 2; index += 1) await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(sent, ['甲', '乙'])
  assert.ok(firstAt - started >= 40, `第一条等了 ${firstAt - started}ms`)
})

test('分段说明只给已绑定且开启分段回复的会话', async t => {
  const off = makeEngine(t)
  assert.equal(off.engine.segmentInstructionForSession(off.sessionId), '')
  assert.equal(off.engine.segmentInstructionForSession('unbound-session'), '')

  const on = makeEngine(t, { segmentReply: true, segmentMarker: MARKER })
  assert.match(on.engine.segmentInstructionForSession(on.sessionId), /<<<MSG>>>/)
  assert.equal(on.engine.segmentInstructionForSession('unbound-session'), '')
})

test('未开放分段回复的渠道不切分，也不注入提示词', async t => {
  // 只在 QQ 上验证过逐条投递；其他渠道即使配置打开了也要保持整段回复。
  const { engine, handlers, sessionId } = makeEngine(t, { segmentReply: true, segmentMarker: MARKER, segmentDelayMinSecs: 0, segmentDelayMaxSecs: 0 }, 'telegram')
  const sent = []
  engine.register({
    id: 'telegram', label: 'Telegram', maxMessageLength: 2000, start() {}, stop() {}, setMessageHandler() {}, status: () => 'connected',
    send: async (_, text) => { sent.push(text) },
  })
  handlers['session/event']({ id: sessionId }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `甲\n${MARKER}\n乙` }] } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, [`甲\n${MARKER}\n乙`])
  assert.equal(engine.segmentInstructionForSession(sessionId), '')
})

test('账号 ID 形式的 QQ 渠道同样识别为已开放并逐条投递', async t => {
  // 真实运行时渠道 ID 是账号 ID（qq_xxx），平台名只在绑定记录里，二者都要认出 QQ。
  const dir = mkdtempSync(join(tmpdir(), 'im-connect-segment-account-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new SessionMapStore(join(dir, 'sessions.json'))
  const accountId = 'qq_8107bade2f35'
  const sessionId = 'im:qq:dm:1700000000000:user-1'
  store.upsert(`${accountId}:dm:user-1`, {
    sessionId,
    channel: accountId,
    kind: 'dm',
    chatId: 'user-1',
    title: '测试',
    updatedAt: '2026-08-17T00:00:00.000Z',
  })
  const handlers = {}
  const ctx = { on: (name, fn) => { handlers[name] = fn; return () => {} } }
  const engine = new ImEngine(ctx, store, new SeenStore(join(dir, 'seen.json')), {
    cwd: dir,
    provider: 'p',
    model: 'm',
    agentPreset: 'standard',
    mergeTimeoutSecs: 1,
    permissionPreset: 'danger-full-access',
    segmentReply: true,
    segmentMarker: MARKER,
    segmentDelayMinSecs: 0,
    segmentDelayMaxSecs: 0,
  }, () => {})
  t.after(() => engine.dispose())
  const sent = []
  engine.register({
    id: accountId, label: 'QQ', maxMessageLength: 2000, start() {}, stop() {}, setMessageHandler() {}, status: () => 'connected',
    send: async (_, text) => { sent.push(text) },
  })
  handlers['session/event']({ id: sessionId }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `甲\n${MARKER}\n乙` }] } } })
  for (let index = 0; index < 50 && sent.length < 2; index += 1) await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(sent, ['甲', '乙'])
  assert.match(engine.segmentInstructionForSession(sessionId), /<<<MSG>>>/)
})
