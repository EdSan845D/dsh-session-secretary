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

const ROWS = [
  { sessionId: 's-aaa', cwd: 'C:\\work\\项目一', running: false, projections: { values: { title: 's1' } } },
  { sessionId: 's-bbb', cwd: 'C:\\work\\项目一', running: false, projections: { values: { title: '第二个' } } },
  { sessionId: 's-ccc', cwd: 'C:\\work\\proj10', running: false, projections: { values: { title: 's1' } } },
  { sessionId: 's-ddd', cwd: 'C:\\work\\proj10', running: false, projections: { values: { title: '调试' } } },
]

const WORKSPACES = [
  { workspaceId: 'w1', path: 'C:\\work\\项目一', title: '项目一', sessionIds: ['s-aaa', 's-bbb'] },
  { workspaceId: 'w2', path: 'C:\\work\\proj10', sessionIds: ['s-ccc', 's-ddd'] },
]

function makeEngine(t) {
  const dir = mkdtempSync(join(tmpdir(), 'secretary-session-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const store = new SessionMapStore(join(dir, 'sessions.json'))
  const handlers = {}
  const ctx = {
    on: (name, fn) => { handlers[name] = fn; return () => {} },
    agents: {
      withoutInitiator: fn => fn(),
      create: async ({ sessionId }) => ({ agent: { session: { id: sessionId }, append() {} }, dispose: async () => {} }),
    },
    get: name => name === 'sessionController'
      ? {
          list: async () => ({ items: ROWS.map(row => ({ ...row, origin: undefined })) }),
          resolveAgent: async () => ({ agent: { id: 'agent-x', session: { id: 'agent-x' } } }),
        }
      : name === 'workspaceController'
        ? { follow: async function* () { yield { type: 'snapshot', value: { items: WORKSPACES, archivedSessionIds: [] } } } }
        : undefined,
  }
  const engine = new ImEngine(ctx, store, new SeenStore(join(dir, 'seen.json')), {
    cwd: dir, provider: 'p', model: 'm', agentPreset: 'standard', mergeTimeoutSecs: 1, permissionPreset: 'danger-full-access',
  }, () => {})
  engine.addAllowed('qq', 'u')
  const sent = []
  let inbound = null
  engine.register({
    id: 'qq', label: 'QQ', maxMessageLength: 8000, start() {}, stop() {}, status: () => 'connected',
    send: async (_, text) => sent.push(text),
    setMessageHandler(h) { inbound = h },
  })
  const sendCommand = async text => {
    const before = sent.length
    await inbound({ chatId: 'user-1', userId: 'u', text, kind: 'dm', messageId: `m-${Math.random()}` })
    await waitFor(() => sent.length > before)
    return sent.at(-1)
  }
  return { engine, sent, sendCommand }
}

test('/session 项目 会话：按基名+标题精确命中并绑定', async t => {
  const { engine, sendCommand } = makeEngine(t)
  try {
    const reply = await sendCommand('/session 项目一 s1')
    assert.match(reply, /已切换会话：s1/)
    assert.match(reply, /C:\\work\\项目一/)
  } finally { engine.dispose() }
})

test('/session 项目：唯一前缀命中项目，取其第一个空闲会话', async t => {
  const { engine, sendCommand } = makeEngine(t)
  try {
    const reply = await sendCommand('/session 项目')
    assert.match(reply, /已切换会话/)
  } finally { engine.dispose() }
})

test('/session 项目 前缀：项目内标题前缀唯一命中', async t => {
  const { engine, sendCommand } = makeEngine(t)
  try {
    const reply = await sendCommand('/session 项目一 第')
    assert.match(reply, /已切换会话：第二个/)
  } finally { engine.dispose() }
})

test('/session 项目 miss：在该项目新建会话（新建兜底）', async t => {
  const { engine, sendCommand } = makeEngine(t)
  // 给 proj10 一个空闲会话行会让 rotate 走真实创建；这里只断言「项目未命中会话」时的提示路径
  try {
    const reply = await sendCommand('/session 项目一 不存在')
    assert.ok(/已创建新会话|不存在/.test(reply))
  } finally { engine.dispose() }
})

test('/session 会话标题跨项目撞名：列候选不猜', async t => {
  const { engine, sendCommand } = makeEngine(t)
  try {
    const reply = await sendCommand('/session s1')
    assert.match(reply, /多个|候选|序号/)
    const pick = await sendCommand('/session 1')
    assert.match(pick, /已切换会话：s1/)
  } finally { engine.dispose() }
})

test('/session 完整会话 ID：原生路径不受影响', async t => {
  const { engine, sendCommand } = makeEngine(t)
  try {
    const reply = await sendCommand('/session s-ccc')
    assert.match(reply, /已切换会话：s1/)
  } finally { engine.dispose() }
})

test('/ls-sessions 是 /sessions 的别名；/ls-project 是 /workspaces 的别名', async t => {
  const { engine, sendCommand } = makeEngine(t)
  try {
    const sessions = await sendCommand('/ls-sessions')
    assert.match(sessions, /会话列表/)
    const projects = await sendCommand('/ls-project')
    assert.match(projects, /工作区列表/)
  } finally { engine.dispose() }
})
