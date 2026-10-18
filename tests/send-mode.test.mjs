import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ImEngine } from '../lib/engine/gateway.js'
import { SessionMapStore } from '../lib/engine/session-store.js'
import { SeenStore } from '../lib/engine/seen-store.js'

/** 账号级发送方式：queue 走 followup 排队，steer 走 Agent 的 next-step 注入。 */
function setup(t, sendMode, { withSteer = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'im-send-mode-'))
  const id = 'account-send-mode-1'
  const sessionId = `im:${id}:dm:1700000000000:u`
  const store = new SessionMapStore(join(dir, 'sessions.json'))
  store.upsert(`${id}:dm:u`, { sessionId, channel: id, kind: 'dm', chatId: 'u', title: 'test', updatedAt: new Date().toISOString() })
  const calls = []
  const agent = { followup: message => calls.push(['followup', message]) }
  if (withSteer) agent.steer = message => calls.push(['steer', message])
  const ctx = new Context()
  ctx.provide('agents')
  ctx.set('agents', { get: () => agent })
  const config = { cwd: dir, provider: 'p', model: 'm', agentPreset: 'standard', mergeTimeoutSecs: 1, permissionPreset: '' }
  const engine = new ImEngine(ctx, store, new SeenStore(join(dir, 'seen.json')), config, () => {},
    undefined, () => ({ ...config, sendMode }))
  const reactions = []
  engine.register({
    id, label: id, maxMessageLength: 4000, skipMerge: true,
    start() {}, stop() {}, status: () => 'on', authorizes: () => true, setMessageHandler() {},
    async send() {},
    async addStatusReaction(message, state, label) { reactions.push({ state, label }); return 'reaction' },
    async removeStatusReaction() {},
  })
  t.after(() => { engine.dispose(); rmSync(dir, { recursive: true, force: true }) })
  return { engine, id, calls, reactions }
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return predicate()
}

test('排队发送（默认）经 followup 提交，消息状态从排队中开始', async t => {
  const h = setup(t, 'queue')
  await h.engine.handleInbound(h.id, { chatId: 'u', userId: 'u', messageId: 'm-queue', text: '看看这个需求' })
  assert.deepEqual(h.calls.map(([kind]) => kind), ['followup'])
  assert.equal(await waitFor(() => h.reactions.length > 0), true)
  assert.equal(h.reactions[0].label, '⏳排队中')
})

test('插话发送经 agent.steer 提交，消息状态直接是思考中', async t => {
  const h = setup(t, 'steer')
  await h.engine.handleInbound(h.id, { chatId: 'u', userId: 'u', messageId: 'm-steer', text: '改一下刚才的需求' })
  assert.deepEqual(h.calls.map(([kind]) => kind), ['steer'])
  assert.equal(await waitFor(() => h.reactions.length > 0), true)
  assert.equal(h.reactions[0].label, '🤔思考中')
})

test('宿主 Agent 没有 steer 时插话发送回落为排队，消息不丢失', async t => {
  const h = setup(t, 'steer', { withSteer: false })
  await h.engine.handleInbound(h.id, { chatId: 'u', userId: 'u', text: '改一下刚才的需求' })
  assert.deepEqual(h.calls.map(([kind]) => kind), ['followup'])
})
