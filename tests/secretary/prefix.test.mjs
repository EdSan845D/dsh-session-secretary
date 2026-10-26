import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ImEngine } from '../../lib/engine/gateway.js'
import { SessionMapStore } from '../../lib/engine/session-store.js'
import { SeenStore } from '../../lib/engine/seen-store.js'

const LABEL = '【proj1·测试】'

/** 一个 qq 私聊绑定 + 可捕获 send/finish 的引擎。 */
function makeEngine(t, { applySessionLabel = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'secretary-prefix-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new SessionMapStore(join(dir, 'sessions.json'))
  const sessionId = 'im:qq:dm:1700000000000:user-1'
  store.upsert('qq:dm:user-1', {
    sessionId,
    channel: 'qq',
    kind: 'dm',
    chatId: 'user-1',
    title: '测试',
    updatedAt: '2026-08-17T00:00:00.000Z',
  })
  const handlers = {}
  const ctx = { on: (name, fn) => { handlers[name] = fn; return () => {} } }
  const engine = new ImEngine(ctx, store, new SeenStore(join(dir, 'seen.json')), {
    cwd: dir, provider: 'p', model: 'm', agentPreset: 'standard', mergeTimeoutSecs: 1, permissionPreset: 'danger-full-access',
  }, () => {})
  engine.applySessionLabel = applySessionLabel
  const sent = []
  engine.register({
    id: 'qq', label: 'QQ', maxMessageLength: 2000, start() {}, stop() {}, setMessageHandler() {}, status: () => 'connected',
    send: async (_, text) => sent.push(['plain', text]),
    beginReply: async () => ({ update: async () => {}, finish: async text => sent.push(['stream', text]) }),
  })
  return { engine, handlers, sent, sessionId }
}

test('assistant/message 投递带会话前缀', async t => {
  const { engine, handlers, sent, sessionId } = makeEngine(t, {
    applySessionLabel: async (text, sid) => (sid === sessionId ? LABEL + text : text),
  })
  try {
    handlers['session/event']({ id: sessionId }, { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: { content: [{ type: 'text', text: 'Answer' }] } } })
    await new Promise(r => setTimeout(r, 20))
    assert.deepEqual(sent, [['plain', `${LABEL}Answer`]])
  } finally { engine.dispose() }
})

test('流式收口 finish 文本带会话前缀', async t => {
  const { engine, handlers, sent, sessionId } = makeEngine(t, {
    applySessionLabel: async text => LABEL + text,
  })
  try {
    handlers['session/event']({ id: sessionId }, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: '流' } } })
    await new Promise(r => setTimeout(r, 10))
    handlers['session/event']({ id: sessionId }, { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: { content: [{ type: 'text', text: '流答' }] } } })
    await new Promise(r => setTimeout(r, 20))
    assert.deepEqual(sent, [['stream', `${LABEL}流答`]])
  } finally { engine.dispose() }
})

test('未注入 labeler 时保持上游原样行为', async t => {
  const { engine, handlers, sent, sessionId } = makeEngine(t)
  try {
    handlers['session/event']({ id: sessionId }, { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: { content: [{ type: 'text', text: 'Answer' }] } } })
    await new Promise(r => setTimeout(r, 20))
    assert.deepEqual(sent, [['plain', 'Answer']])
  } finally { engine.dispose() }
})

test('labeler 抛错时退回原文投递，不丢回复', async t => {
  const { engine, handlers, sent, sessionId } = makeEngine(t, {
    applySessionLabel: async () => { throw new Error('label down') },
  })
  try {
    handlers['session/event']({ id: sessionId }, { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: { content: [{ type: 'text', text: 'Answer' }] } } })
    await new Promise(r => setTimeout(r, 20))
    assert.deepEqual(sent, [['plain', 'Answer']])
  } finally { engine.dispose() }
})
