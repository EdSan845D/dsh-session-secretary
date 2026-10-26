import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ImEngine } from '../../lib/engine/gateway.js'
import { SessionMapStore } from '../../lib/engine/session-store.js'
import { SeenStore } from '../../lib/engine/seen-store.js'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor(check, timeoutMs = 2000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时')
    await sleep(10)
  }
}

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
    await waitFor(() => consumed.length === 1)
    await sleep(20)
    assert.equal(sent.length, 0, '消费后不应触发任何原生回执')
  } finally { engine.dispose() }
})

test('未命中 pending 的文本原样放行（/help 正常回执）', async t => {
  const { engine, sent, inbound } = makeEngine(t)
  engine.secretaryInbound = async msg => msg.text === '[a3f2] 批准'
  try {
    await inbound({ chatId: 'user-1', userId: 'u', text: '/help', kind: 'dm', messageId: 'm2' })
    await waitFor(() => sent.length > 0)
  } finally { engine.dispose() }
})

test('普通聊天文本不触发截断（hook 返回 false）', async t => {
  const { engine, inbound } = makeEngine(t)
  engine.secretaryInbound = async () => false
  try {
    await inbound({ chatId: 'user-1', userId: 'u', text: '普通聊天', kind: 'dm', messageId: 'm3' })
    await sleep(20)
    assert.ok(true)
  } finally { engine.dispose() }
})

test('hook 抛错不阻塞原生流程', async t => {
  const { engine, sent, inbound } = makeEngine(t)
  engine.secretaryInbound = async () => { throw new Error('secretary down') }
  try {
    await inbound({ chatId: 'user-1', userId: 'u', text: '/help', kind: 'dm', messageId: 'm4' })
    await waitFor(() => sent.length > 0, 3000)
  } finally { engine.dispose() }
})
