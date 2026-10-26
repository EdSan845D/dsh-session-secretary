import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSecretaryBridge, type SecretaryBridgeConfig, type SecretaryDispatch } from '../../src/secretary/bridge.ts'
import type { ControlDelivery } from '../../src/secretary/types.ts'

const silentLogger = { warn: () => undefined, debug: () => undefined }

/** 固定标签，断言稳定（random → 0 ⇒ '0000'）。 */
const FIXED_RANDOM = () => 0

function config(overrides: Partial<SecretaryBridgeConfig> = {}): SecretaryBridgeConfig {
  return {
    notifyQuestion: true,
    notifyApproval: true,
    maxForwardChars: 1200,
    pendingTtlMinutes: 1440,
    ...overrides,
  }
}

/** 假控制投递：只记录发出去的文本。 */
function fakeDelivery() {
  const sent: string[] = []
  const delivery = {
    sent,
    async sendControlText(text: string) { sent.push(text); return true },
  } satisfies ControlDelivery & { sent: string[] }
  return delivery
}

const AGENT = {
  id: 'session-1',
  session: { id: 'session-1', header: { cwd: 'C:\\work\\demo', origin: undefined } },
}
const SUBAGENT = {
  id: 'session-2',
  session: { id: 'session-2', header: { cwd: 'C:\\work\\demo', origin: 'subagent' } },
}

const QUESTION = {
  id: 'mode',
  question: '选择运行模式？',
  options: [{ label: '快速' }, { label: '完整' }],
}

/** 装配一个秘书桥 + 捕获转发内容。 */
function harness(options: { config?: SecretaryBridgeConfig; delivery?: ControlDelivery & { sent: string[] }; bound?: boolean } = {}) {
  const dispatched: SecretaryDispatch[] = []
  const delivery = options.delivery ?? fakeDelivery()
  const bridge = createSecretaryBridge({
    readConfig: () => options.config ?? config(),
    delivery,
    isSessionBound: sessionId => options.bound === true && sessionId === 'session-1',
    dispatch: (signal) => dispatched.push(signal),
    titleOf: (sessionId) => (sessionId === 'session-1' ? '我的会话' : undefined),
    logger: silentLogger,
    random: FIXED_RANDOM,
  })
  return { bridge, dispatched, delivery }
}

/** 一条入站文本消息。 */
function inbox(id: string, text: string) {
  return { message: { id, content: [{ type: 'text', text }] } }
}

/** 永不落定的 Promise：模拟「没有任何客户端应答器」。 */
const never = () => new Promise<never>(() => undefined)

function noProvider(): never {
  const error = new Error('no provider') as Error & { code: string }
  error.code = 'NO_PROVIDER'
  throw error
}

afterEach(() => {
  vi.useRealTimers()
})

describe('秘书桥 · 提问', () => {
  it('转发带选项与标签，并把 IM 回复当作答案返回', async () => {
    const { bridge, dispatched } = harness()
    const pending = bridge.onQuestions(
      { agent: AGENT, questions: [QUESTION] },
      never as never,
    )
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    expect(dispatched[0]?.body).toMatch(/1\. 快速/)
    expect(dispatched[0]?.body.trimEnd().endsWith('[0000]')).toBe(true)
    expect(dispatched[0]?.title).toBe('需要你回答')

    bridge.onInboxClaimed(inbox('m1', '[0000] 2'))
    expect(await pending).toEqual({ answers: [{ id: 'mode', selected: ['完整'] }] })
  })

  it('会话标题可用时用它做标签（比目录名更好认）', async () => {
    const { bridge, dispatched } = harness({ config: config() })
    void bridge.onQuestions({ agent: AGENT, questions: [QUESTION] }, never as never)
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    expect(dispatched[0]?.body).toMatch(/会话〈我的会话〉/)
  })

  it('原生应答先到就用原生的（界面点选与 IM 回复互不排斥）', async () => {
    const { bridge } = harness()
    const answer = await bridge.onQuestions(
      { agent: AGENT, questions: [QUESTION] },
      async () => ({ answers: [{ selected: ['快速'] }] }),
    )
    expect(answer).toEqual({ answers: [{ selected: ['快速'] }] })
  })

  it('无人应答（NO_PROVIDER）时挂住 waterfall 等 IM，而不是让工具失败', async () => {
    const { bridge, dispatched } = harness()
    const pending = bridge.onQuestions(
      { agent: AGENT, questions: [QUESTION] },
      () => Promise.reject(noProvider()) as never,
    )
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    bridge.onInboxClaimed(inbox('m1', '完整'))
    expect(await pending).toEqual({ answers: [{ id: 'mode', selected: ['完整'] }] })
  })

  it('闲聊句不会被当成答案（严格匹配）', async () => {
    const { bridge, dispatched } = harness()
    const pending = bridge.onQuestions({ agent: AGENT, questions: [QUESTION] }, never as never)
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    bridge.onInboxClaimed(inbox('m1', '帮我看看日志'))
    bridge.onInboxClaimed(inbox('m2', '[0000] 1'))
    expect(await pending).toEqual({ answers: [{ id: 'mode', selected: ['快速'] }] })
  })

  it('子代理会话不转发（与通知侧「仅根会话」一致）', async () => {
    const { bridge, dispatched } = harness()
    await bridge.onQuestions({ agent: SUBAGENT, questions: [QUESTION] }, async () => undefined)
    expect(dispatched).toHaveLength(0)
  })

  it('关闭 notifyQuestion 后完全不接管提问', async () => {
    const offQuestion = harness({ config: config({ notifyQuestion: false }) })
    await offQuestion.bridge.onQuestions({ agent: AGENT, questions: [QUESTION] }, async () => ({ answers: [] }))
    expect(offQuestion.dispatched).toHaveLength(0)
  })

  it('阶段二（continued）：abort 后经 userQuestions.answer 补答', async () => {
    const { bridge, dispatched } = harness()
    const controller = new AbortController()
    const answered: Array<{ callId: string; answers: unknown }> = []
    const service: UserQuestionsService = {
      answer(_agent, callId, payload) {
        answered.push({ callId, answers: payload.answers })
        return true
      },
    }
    bridge.setUserQuestions(service)

    const pending = bridge.onQuestions(
      { agent: AGENT, questions: [QUESTION], wait: { callId: 'call-9' }, signal: controller.signal },
      never as never,
    )
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    controller.abort()
    await expect(pending).rejects.toThrow('interaction aborted')

    bridge.onInboxClaimed(inbox('m1', '[0000] 2'))
    await vi.waitFor(() => expect(answered).toHaveLength(1))
    expect(answered[0]?.callId).toBe('call-9')
  })

  it('阶段二作答被拒（BAD_ANSWER）：提示用户重发且不丢待办', async () => {
    const { bridge, dispatched, delivery } = harness()
    const controller = new AbortController()
    bridge.setUserQuestions({
      answer() {
        const error = new Error('bad') as Error & { code: string }
        error.code = 'BAD_ANSWER'
        throw error
      },
    })
    const pending = bridge.onQuestions(
      { agent: AGENT, questions: [QUESTION], wait: { callId: 'call-1' }, signal: controller.signal },
      never as never,
    )
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    controller.abort()
    await expect(pending).rejects.toThrow()

    bridge.onInboxClaimed(inbox('m1', '[0000] 2'))
    await vi.waitFor(() => expect(delivery.sent.some(text => text.includes('格式没对上'))).toBe(true))
  })
})

describe('秘书桥 · 审批', () => {
  it('IM 回「批准」→ allowed-once，并回一条确认', async () => {
    const { bridge, dispatched, delivery } = harness()
    const pending = bridge.onApproval({ agent: AGENT, toolName: 'bash', callId: 'c1', reason: '需要提权' }, never as never)
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    expect(dispatched[0]?.body).toMatch(/工具：bash/)
    expect(dispatched[0]?.body).toMatch(/需要提权/)

    bridge.onInboxClaimed(inbox('m1', '[0000] 批准'))
    expect(await pending).toBe('allowed-once')
    await vi.waitFor(() => expect(delivery.sent.some(text => text.includes('已批准'))).toBe(true))
  })

  it('IM 回「拒绝」→ rejected', async () => {
    const { bridge, dispatched } = harness()
    const pending = bridge.onApproval({ agent: AGENT, toolName: 'bash' }, never as never)
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    bridge.onInboxClaimed(inbox('m1', 'no'))
    expect(await pending).toBe('rejected')
  })

  it('displayReason 是按语种索引的对象：取中文、英文兜底', async () => {
    const { bridge, dispatched } = harness()
    void bridge.onApproval(
      { agent: AGENT, toolName: 'bash', displayReason: { en: 'needs sudo', zh: '需要管理员权限' } },
      never as never,
    )
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    expect(dispatched[0]?.body).toMatch(/需要管理员权限/)
  })

  it('超时自动拒绝（工具不能无限期挂起）', async () => {
    vi.useFakeTimers()
    const { bridge, dispatched, delivery } = harness({ config: config({ pendingTtlMinutes: 1 }) })
    const pending = bridge.onApproval({ agent: AGENT, toolName: 'bash' }, never as never)
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    vi.advanceTimersByTime(60_000)
    expect(await pending).toBe('rejected')
    expect(delivery.sent.some(text => text.includes('超时'))).toBe(true)
  })

  it('审批没有阶段二：abort 直接抛出，不会留下待办', async () => {
    const { bridge, dispatched } = harness()
    const controller = new AbortController()
    const pending = bridge.onApproval(
      { agent: AGENT, toolName: 'bash', signal: controller.signal },
      never as never,
    )
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    controller.abort()
    await expect(pending).rejects.toThrow('interaction aborted')
  })
})

describe('秘书桥 · 回复回收', () => {

  it('被消费的回复在 pre-step 里从消息列表剔除（不会当成新的用户指令）', async () => {
    const { bridge, dispatched } = harness()
    const pending = bridge.onQuestions({ agent: AGENT, questions: [QUESTION] }, never as never)
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    bridge.onInboxClaimed(inbox('m1', '[0000] 1'))
    await pending

    const decision = await bridge.onPreStep({ step: 2 }, async () => ({
      kind: 'enter',
      messages: [{ id: 'm1' }, { id: 'other' }],
    }))
    expect(decision).toEqual({ kind: 'enter', messages: [{ id: 'other' }] })
  })

  it('消息被清空且不是 step 1 → 拒绝这一步', async () => {
    const { bridge, dispatched } = harness()
    const pending = bridge.onQuestions({ agent: AGENT, questions: [QUESTION] }, never as never)
    await vi.waitFor(() => expect(dispatched).toHaveLength(1))
    bridge.onInboxClaimed(inbox('m1', '[0000] 1'))
    await pending

    const decision = await bridge.onPreStep({ step: 3 }, async () => ({
      kind: 'enter',
      messages: [{ id: 'm1' }],
    }))
    expect(decision).toEqual({ kind: 'reject' })
  })

  it('无待办时 pre-step 原样放行（零开销短路）', async () => {
    const { bridge } = harness()
    const decision = await bridge.onPreStep({ step: 1 }, async () => ({
      kind: 'enter',
      messages: [{ id: 'keep' }],
    }))
    expect(decision).toEqual({ kind: 'enter', messages: [{ id: 'keep' }] })
  })

  it('已绑定到聊天的会话不再转发（原生按钮流程接管，两条链路不抢同一件事）', async () => {
    const { bridge, dispatched } = harness({ bound: true })
    await bridge.onQuestions({ agent: AGENT, questions: [QUESTION] }, async () => ({ answers: [] }))
    expect(dispatched).toHaveLength(0)

    const approval = harness({ bound: true })
    await approval.bridge.onApproval({ agent: AGENT, toolName: 'bash' }, async () => 'rejected')
    expect(approval.dispatched).toHaveLength(0)
  })
})
