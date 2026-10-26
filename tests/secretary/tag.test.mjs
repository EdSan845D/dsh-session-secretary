import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ImEngine } from '../../lib/engine/gateway.js'
import { SessionMapStore } from '../../lib/engine/session-store.js'
import { SeenStore } from '../../lib/engine/seen-store.js'

function makeEngine(t) {
  const dir = mkdtempSync(join(tmpdir(), 'secretary-tag-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new SessionMapStore(join(dir, 'sessions.json'))
  const handlers = {}
  const ctx = { on: (name, fn) => { handlers[name] = fn; return () => {} } }
  const engine = new ImEngine(ctx, store, new SeenStore(join(dir, 'seen.json')), {
    cwd: dir, provider: 'p', model: 'm', agentPreset: 'standard', mergeTimeoutSecs: 1, permissionPreset: 'danger-full-access',
  }, () => {})
  engine.addAllowed('qq', 'u')
  const sent = []
  let inbound = null
  engine.register({
    id: 'qq', label: 'QQ', maxMessageLength: 2000, start() {}, stop() {}, status: () => 'connected',
    send: async (_, text) => sent.push(text),
    setMessageHandler(h) { inbound = h },
  })
  return { engine, handlers, sent, inbound }
}

test('命中秘书 pending 的带 tag 回复被截断消费，不进原生命令/交互流程', async t => {
  const { engine, sent, inbound } = makeEngine(t)
  const consumed = []
  engine.secretaryInbound = async msg => {
    if (msg.text === '[a3f2] 批准') { consumed.push(msg.text); return true }
    return false
  }
  try {
    await inbound({ chatId: 'user-1', userId: 'u', text: '[a3f2] 批准', kind: 'dm', messageId: 'm1' })
    assert.equal(consumed.length, 1)
    assert.equal(sent.length, 0, '消费后不应触发任何原生回执')
  } finally { engine.dispose() }
})

test('未命中 pending 的方括号文本不截断，走原生流程（/help 可达）', async t => {
  const { engine, sent, inbound } = makeEngine(t)
  engine.secretaryInbound = async msg => msg.text === '[a3f2] 批准'
  try {
    await inbound({ chatId: 'user-1', userId: 'u', text: '[备注] /help', kind: 'dm', messageId: 'm2' })
    await new Promise(r => setTimeout(r, 10))
    assert.ok(sent.length > 0, '/help 应正常回执，证明原生流程未被截断')
  } finally { engine.dispose() }
})

test('普通聊天文本不触发截断（hook 返回 false）', async t => {
  const { engine, sent, inbound } = makeEngine(t)
  engine.secretaryInbound = async () => false
  try {
    await inbound({ chatId: 'user-1', userId: 'u', text: '普通聊天', kind: 'dm', messageId: 'm3' })
    await new Promise(r => setTimeout(r, 10))
    assert.ok(true)
  } finally { engine.dispose() }
})

test('hook 抛错不阻塞原生流程', async t => {
  const { engine, sent, inbound } = makeEngine(t)
  engine.secretaryInbound = async () => { throw new Error('secretary down') }
  try {
    await inbound({ chatId: 'user-1', userId: 'u', text: '/help', kind: 'dm', messageId: 'm4' })
    await new Promise(r => setTimeout(r, 10))
    assert.ok(sent.length > 0, 'hook 异常后 /help 仍应回执')
  } finally { engine.dispose() }
})
