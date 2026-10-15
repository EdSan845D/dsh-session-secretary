import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChannelAdapter } from '../lib/channels/factory.js'
import { ImEngine } from '../lib/engine/gateway.js'
import { SessionMapStore } from '../lib/engine/session-store.js'
import { SeenStore } from '../lib/engine/seen-store.js'
import { ChoiceSendError } from '../lib/engine/choice-delivery.js'

const message = { chatId: 'user', userId: 'user', kind: 'dm', text: '' }
const options = [{ label: '简短说明', description: '仅概括要点' }, { label: '详细说明', description: '展开关键细节' }]
const tick = () => new Promise(resolve => setImmediate(resolve))
async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await tick()
  }
  assert.fail('提问未进入可回答状态')
}

/** 真实渠道能力、引擎提问和回调链路；仅替换网络出口，不启动渠道连接。 */
function fixture(t, platform = 'wecom') {
  const dir = mkdtempSync(join(tmpdir(), 'im-question-card-'))
  const accountId = 'opaque-account'
  const sessionId = `im:${accountId}:dm:1700000000000:user`
  const store = new SessionMapStore(join(dir, 'sessions.json'))
  store.upsert(`${accountId}:dm:user`, { sessionId, channel: accountId, kind: 'dm', chatId: 'user', title: '测试会话', updatedAt: new Date().toISOString() })
  const ctx = { on() { return () => {} }, get(name) {
    if (name === 'settings') return { get: () => ({ preference: 'zh' }) }
  } }
  const engine = new ImEngine(ctx, store, new SeenStore(join(dir, 'seen.json')),
    { cwd: dir, provider: 'p', model: 'm', agentPreset: '', mergeTimeoutSecs: 1, permissionPreset: '' }, () => {})
  const config = Object.fromEntries(['token', 'appToken', 'appId', 'appSecret', 'clientId', 'clientSecret', 'botId', 'secret'].map(key => [key, 'offline-fixture']))
  const channel = createChannelAdapter(platform, config, () => {}, dir, { accountId })
  assert.ok(channel)
  const cards = [], sent = []
  channel.send = async (_chat, text) => { sent.push(text) }
  if (channel.sendChoices) channel.sendChoices = async (_msg, text, buttons, metadata) => { cards.push({ text, buttons, metadata }) }
  channel.sendAction = undefined
  channel.stopAction = undefined
  engine.register(channel)
  engine.addAllowed(accountId, 'user')
  t.after(() => { engine.dispose(); rmSync(dir, { recursive: true, force: true }) })
  const ask = (questions = [{ id: 'style', question: '请选择说明类型', options }]) => {
    const work = engine.onUserQuestions({ agent: { session: { id: sessionId } }, questions }, async () => assert.fail('已绑定会话不能回退网页提问'))
    // 断言失败时清理会取消等待，提前观察拒绝，避免未处理的 Promise。
    void work.catch(() => {})
    return work
  }
  const answer = input => engine.handleInbound(accountId, { ...message, ...input })
  return { engine, channel, cards, sent, sessionId, ask, answer }
}

const occurrences = (text, value) => text.split(value).length - 1

const nativePlatforms = ['wecom', 'feishu', 'lark', 'dingtalk', 'telegram', 'discord', 'slack']
for (const platform of nativePlatforms) test(`${platform} 提问选项只展示一次，描述保留且按钮仍返回真实选择`, async t => {
  const f = fixture(t, platform)
  const pending = f.ask()
  await waitFor(() => f.cards.length === 1 && f.engine.questions.isReady(f.sessionId))
  const card = f.cards[0]
  assert.equal(occurrences(card.text, '1. 简短说明'), 1)
  assert.equal(occurrences(card.text, '2. 详细说明'), 1)
  assert.match(card.text, /简短说明 — 仅概括要点/)
  assert.match(card.text, /详细说明 — 展开关键细节/)
  assert.deepEqual(card.buttons.map(button => button.label), ['简短说明', '详细说明'])
  assert.equal(card.metadata.numberedChoicesIncluded, true)
  await f.answer({ actionToken: card.buttons[1].token })
  assert.deepEqual(await pending, { answers: [{ id: 'style', selected: ['详细说明'] }] })
  assert.deepEqual(f.sent, [])
})

for (const platform of nativePlatforms) for (const mode of ['rejected', 'capacity']) test(`${platform} 提问卡片 ${mode} 时完整回退为一组选项`, async t => {
  const f = fixture(t, platform)
  let attempts = 0
  f.channel.sendChoices = async () => {
    attempts++
    throw new ChoiceSendError('rejected')
  }
  if (mode === 'capacity') f.channel.choiceLimits = { maxButtons: 0, maxTextLength: 4000 }
  const pending = f.ask()
  await waitFor(() => f.sent.length === 1 && f.engine.questions.isReady(f.sessionId))
  assert.equal(attempts, mode === 'rejected' ? 1 : 0)
  assert.equal(occurrences(f.sent[0], '1. 简短说明'), 1)
  assert.equal(occurrences(f.sent[0], '2. 详细说明'), 1)
  assert.match(f.sent[0], /仅概括要点/)
  assert.doesNotMatch(f.sent[0], /点击按钮/)
  await f.answer({ text: '2' })
  assert.deepEqual(await pending, { answers: [{ id: 'style', selected: ['详细说明'] }] })
})

for (const platform of ['weixin', 'qq']) test(`${platform} 保持原有文字提问和数字回答`, async t => {
  const f = fixture(t, platform)
  const pending = f.ask()
  await waitFor(() => f.sent.length === 1 && f.engine.questions.isReady(f.sessionId))
  assert.equal(f.cards.length, 0)
  assert.equal(occurrences(f.sent[0], '1. 简短说明'), 1)
  assert.equal(occurrences(f.sent[0], '2. 详细说明'), 1)
  await f.answer({ text: '1' })
  assert.deepEqual(await pending, { answers: [{ id: 'style', selected: ['简短说明'] }] })
})

for (const platform of nativePlatforms) test(`${platform} 多选刷新不重复列表，选中标记及提交按钮保持可用`, async t => {
  const f = fixture(t, platform)
  const pending = f.ask([{ id: 'style', question: '请选择说明类型', options, multiSelect: true }])
  await waitFor(() => f.cards.length === 1 && f.engine.questions.isReady(f.sessionId))
  assert.equal(f.cards[0].buttons.length, 2)
  await f.answer({ actionToken: f.cards.at(-1).buttons[0].token })
  let card = f.cards.at(-1)
  assert.deepEqual(card.buttons.map(button => button.label), ['✓ 简短说明', '详细说明', '提交所选'])
  assert.match(card.text, /1\. ✓ 简短说明 — 仅概括要点/)
  assert.equal(occurrences(card.text, '简短说明'), 1)
  assert.equal(occurrences(card.text, '2. 详细说明'), 1)
  assert.equal(occurrences(card.text, '3. 提交所选'), 1)
  assert.ok(card.text.indexOf('3. 提交所选') < card.text.indexOf('请回复选项序号'), '提交项应在回复说明之前')
  await f.answer({ actionToken: card.buttons[0].token })
  card = f.cards.at(-1)
  assert.equal(card.buttons.length, 2, '取消最后一个已选项后移除提交按钮')
  assert.doesNotMatch(card.text, /提交所选/)
  await f.answer({ actionToken: card.buttons[1].token })
  card = f.cards.at(-1)
  assert.deepEqual(card.buttons.map(button => button.label), ['简短说明', '✓ 详细说明', '提交所选'])
  assert.equal(occurrences(card.text, '1. 简短说明'), 1)
  assert.equal(occurrences(card.text, '2. ✓ 详细说明'), 1)
  assert.match(card.text, /2\. ✓ 详细说明 — 展开关键细节/)
  assert.equal(occurrences(card.text, '3. 提交所选'), 1)
  assert.ok(card.text.indexOf('3. 提交所选') < card.text.indexOf('请回复选项序号'), '提交项应在回复说明之前')
  await f.answer({ actionToken: card.buttons[2].token })
  assert.deepEqual(await pending, { answers: [{ id: 'style', selected: ['详细说明'] }] })
})

test('开放问题保持文字回答，不生成空选项卡片', async t => {
  const f = fixture(t)
  const pending = f.ask([{ id: 'detail', question: '请输入补充说明' }])
  await waitFor(() => f.sent.length === 1 && f.engine.questions.isReady(f.sessionId))
  assert.deepEqual(f.cards, [])
  assert.match(f.sent[0], /请输入补充说明/)
  await f.answer({ text: '自定义内容' })
  assert.deepEqual(await pending, { answers: [{ id: 'detail', selected: [], custom: '自定义内容' }] })
})

test('审批选项未预写入正文时仍自动编号，不受提问过滤影响', async t => {
  const f = fixture(t)
  const result = await f.engine.deliverInteraction(f.channel, message.chatId, '请确认是否执行操作', undefined, {
    sessionId: f.sessionId, message,
    choices: [{ label: '批准一次', value: 'allow' }, { label: '拒绝', value: 'reject' }], valid: () => true,
  })
  assert.equal(result.status, 'delivered')
  assert.equal(f.cards.length, 1)
  assert.equal(occurrences(f.cards[0].text, '1. 批准一次'), 1)
  assert.equal(occurrences(f.cards[0].text, '2. 拒绝'), 1)
  assert.deepEqual(f.cards[0].buttons.map(button => button.label), ['批准一次', '拒绝'])
})

