/**
 * 秘书桥：把「需要你回答 / 需要你批准」挂起，转发到 IM，并把 IM 的回复送回去。
 *
 * 两阶段作答（DSH 0.2.1-rc.3 实测）：
 * - **阶段一（前台窗口内）**：提问的 waterfall 还开着，秘书桥让 IM 回复与
 *   「原生应答」赛跑 —— 谁先到谁生效，Web 端点选、dsh-im 会话同步照旧可用。
 *   没有任何客户端应答器时宿主会抛 `NO_PROVIDER`，此时**挂住 waterfall 等 IM**，
 *   而不是让工具调用失败（这正是「人在外面也要能答」的场景）。
 * - **阶段二（continued）**：前台窗口超时后提问降级为 `continued`，waterfall 已
 *   结束，唯一还能作答的入口是 `ctx.userQuestions.answer(agent, callId, …)`；
 *   秘书桥据此补答，`BAD_ANSWER` 时回一条 IM 提示用户重发。
 *
 * 审批没有阶段二：waterfall 的返回值就是裁决结果，超时只能自动拒绝 ——
 * 让工具永久挂起比拒绝更糟（与 dsh-im 的处理一致）。
 */

import { renderApproval } from './approval-text.js'
import { renderQuestions } from './reply-text.js'
import { messageText, newTag, routeReply } from './routing.js'
import type {
  AbortSignalLike,
  ApprovalDecision,
  ApprovalOutcomeLike,
  ApprovalRequest,
  ControlDelivery,
  InboxClaimed,
  PreStepDecision,
  PreStepPayload,
  QuestionAnswer,
  SecretaryAgent,
  SecretaryQuestion,
  UserQuestionsAnswer,
  UserQuestionsRequest,
  UserQuestionsService,
} from './types.js'

/** 桥读取的配置面（index.ts 从 fork Config 的 secretary 组映射）。 */
export interface SecretaryBridgeConfig {
  notifyQuestion: boolean
  notifyApproval: boolean
  maxForwardChars: number
  pendingTtlMinutes: number
}

/** 提问待办。 */
interface PendingQuestion {
  kind: 'question'
  tag: string
  sessionId: string
  label: string
  callId: string | null
  questions: SecretaryQuestion[]
  agent: SecretaryAgent | undefined
  /** 阶段一（waterfall 开着）/ 阶段二（continued，走 `answer()`）。 */
  phase: 'one' | 'two'
  settled: boolean
  resolveReply: ((answer: QuestionAnswer[]) => void) | null
  timer: ReturnType<typeof setTimeout> | null
}

/** 审批待办。 */
interface PendingApproval {
  kind: 'approval'
  tag: string
  sessionId: string
  label: string
  settled: boolean
  resolve: ((decision: ApprovalDecision) => void) | null
  timer: ReturnType<typeof setTimeout> | null
}

type Pending = PendingQuestion | PendingApproval

/** 待办表上限（长时间运行下防无界增长）。 */
const PENDING_LIMIT = 200
/** 已消费回复的记录上限：只在 pre-step 过滤时需要，用掉即弃。 */
const DISCARDED_LIMIT = 200
/** 审批 TTL 上限（分钟）：工具调用不该无限期挂起。 */
const APPROVAL_TTL_CAP_MINUTES = 60

/** 秘书信号（交给调度器分发到所有已启用通道）。 */
export interface SecretaryDispatch {
  sessionId: string
  tag: string
  title: string
  body: string
}

export interface BridgeLogger {
  warn(message: string): void
  debug?(message: string): void
}

export interface SecretaryBridgeOptions {
  /** 每次用时读取的秘书配置（volatile 引用，绝不缓存快照）。 */
  readConfig: () => SecretaryBridgeConfig
  /** 控制聊天投递（经本插件自有渠道直发）。 */
  delivery: ControlDelivery
  /** 该会话是否已被原生绑定到一个聊天（绑定 → 原生引擎接管，桥跳过）。 */
  isSessionBound(sessionId: string): boolean
  /** 秘书信号出口（经调度器分发到所有通道）。 */
  dispatch(signal: SecretaryDispatch): void
  /** 会话 id → 会话标题（调度器持有）。 */
  titleOf(sessionId: string): string | undefined
  logger: BridgeLogger
  now?: () => number
  /** 标签随机源（测试可注入）。 */
  random?: () => number
}

export interface SecretaryBridge {
  onQuestions(
    request: UserQuestionsRequest,
    next: () => Promise<UserQuestionsAnswer | undefined>,
  ): Promise<UserQuestionsAnswer | undefined>
  onApproval(
    request: ApprovalRequest,
    next: () => Promise<ApprovalOutcomeLike>,
  ): Promise<ApprovalOutcomeLike>
  onInboxClaimed(payload: InboxClaimed): void
  onPreStep(
    payload: PreStepPayload,
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision>
  /** 注入 `ctx.userQuestions` 服务（阶段二作答需要）。 */
  setUserQuestions(service: UserQuestionsService | undefined): void
  dispose(): void
}

/** 竞速结果：IM 回复或原生应答谁先到。 */
type RaceOutcome<T> =
  | { source: 'im'; value: T }
  | { source: 'native'; value: unknown }

/** IM 回复与原生应答赛跑，并监听 abort（前台窗口关闭 = 转入阶段二）。 */
function raceReply<T>(input: {
  reply: Promise<T>
  native: Promise<unknown>
  signal?: AbortSignalLike
}): Promise<RaceOutcome<T>> {
  return new Promise<RaceOutcome<T>>((resolve, reject) => {
    let settled = false
    const finish = () => {
      settled = true
      input.signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      if (settled) return
      finish()
      reject(new Error('interaction aborted'))
    }
    input.signal?.addEventListener('abort', onAbort, { once: true })
    input.reply.then(
      (value) => {
        if (settled) return
        finish()
        resolve({ source: 'im', value })
      },
      () => undefined, // IM 回复永不 reject：等不到就等原生或超时
    )
    input.native.then(
      (value) => {
        if (settled) return
        finish()
        resolve({ source: 'native', value })
      },
      (error: unknown) => {
        if (settled) return
        finish()
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** 错误码提取（宿主用 `{ code }` 形态抛错）。 */
function codeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code?: unknown }).code)
  }
  return ''
}

/**
 * 原生应答缺席时挂住 waterfall。
 *
 * `NO_PROVIDER` 是宿主的**预期状态**（没有客户端应答器），不是错误：
 * 此时把 Promise 永久挂起，等 IM 回复来解开，而不是让工具调用失败。
 */
function holdWhenNoProvider(native: Promise<unknown>): Promise<unknown> {
  return native.catch((error: unknown) => {
    if (codeOf(error) === 'NO_PROVIDER') return new Promise<never>(() => undefined)
    throw error
  })
}

/** 会话标签（cwd 末段；无则由渲染层显示「未命名」）。 */
function sessionLabel(session: SecretaryAgent['session']): string {
  const cwd = session?.header?.cwd
  if (typeof cwd === 'string' && cwd.trim() !== '') {
    const parts = cwd.split(/[\\/]/).filter(part => part !== '')
    const last = parts[parts.length - 1]
    if (typeof last === 'string' && last !== '') return last
  }
  return ''
}

/**
 * 审批原因：`reason` 缺失时退回本地化的 `displayReason`。
 *
 * ⚠️ `displayReason` 是**按语种索引的对象**（`{ en, zh, … }`）而不是字符串，
 * 取中文优先、英文兜底，都没有时取第一个字符串值。
 */
function approvalReasonOf(request: ApprovalRequest): string {
  const reason = request.reason
  if (typeof reason === 'string' && reason.trim() !== '') return reason.trim()
  const display = request.displayReason
  if (display === undefined) return ''
  const zh = display.zh
  if (typeof zh === 'string' && zh !== '') return zh
  const en = display.en
  if (typeof en === 'string' && en !== '') return en
  for (const value of Object.values(display)) {
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

/** 根会话判定：子代理不转发（与通知侧「仅根会话」一致）。 */
function isRootSession(session: SecretaryAgent['session']): boolean {
  return session?.header?.origin !== 'subagent'
}

/**
 * 装配秘书桥。所有依赖以函数注入：配置与通道都**用时求值**，
 * 这样设置页改配置能立刻生效（与调度器同一套约定）。
 */
export function createSecretaryBridge(options: SecretaryBridgeOptions): SecretaryBridge {
  const { readConfig, delivery, dispatch, logger } = options
  const random = options.random ?? Math.random

  const questions = new Map<string, PendingQuestion>()
  const approvals = new Map<string, PendingApproval>()
  /** 已消费的入站消息 id → 标签（pre-step 据此丢弃）。 */
  const discarded = new Map<string, string>()
  let userQuestions: UserQuestionsService | undefined

  function dropPending(pending: Pending): void {
    if (pending.timer !== null) {
      clearTimeout(pending.timer)
      pending.timer = null
    }
    pending.settled = true
    questions.delete(pending.tag)
    approvals.delete(pending.tag)
  }

  function trimMap(map: Map<string, unknown>): void {
    if (map.size <= PENDING_LIMIT) return
    const oldest = map.keys().next()
    if (oldest.done !== true) map.delete(oldest.value)
  }

  function rememberDiscarded(messageId: string, tag: string): void {
    discarded.set(messageId, tag)
    while (discarded.size > DISCARDED_LIMIT) {
      const oldest = discarded.keys().next()
      if (oldest.done === true) break
      discarded.delete(oldest.value)
    }
  }

  /** 挂上 TTL：审批有 60 分钟上限，超时自动拒绝。 */
  function armTtl(pending: Pending): void {
    const minutes = Number(readConfig().pendingTtlMinutes)
    const effective = pending.kind === 'approval'
      ? Math.min(APPROVAL_TTL_CAP_MINUTES, Math.max(1, minutes > 0 ? minutes : 60))
      : Math.max(1, minutes > 0 ? minutes : 1440)
    pending.timer = setTimeout(() => {
      const isApproval = pending.kind === 'approval'
      const resolve = isApproval ? pending.resolve : null
      dropPending(pending)
      if (isApproval) {
        resolve?.('rejected')
        void delivery.sendControlText(`⏰ 审批已超时，已自动拒绝此次操作。[${pending.tag}]`)
      }
    }, effective * 60_000)
    pending.timer.unref?.()
  }

  function mintTag(): string {
    let tag = newTag(random)
    while (questions.has(tag) || approvals.has(tag)) tag = newTag(random)
    return tag
  }

  function sessionIdOf(agent: SecretaryAgent | undefined): string | null {
    const id = agent?.session?.id ?? agent?.id
    if (typeof id !== 'string' || id === '') return null
    if (!isRootSession(agent?.session)) return null
    return id
  }

  /** 已绑定到聊天的会话由原生引擎接管（提问/审批按钮），桥跳过避免抢答。 */
  function skipSession(sessionId: string): boolean {
    return options.isSessionBound(sessionId)
  }

  function maxCharsOf(config: SecretaryBridgeConfig): number {
    const value = Number(config.maxForwardChars)
    return value > 0 ? value : 1200
  }

  /** 阶段二作答：把回复补进已经 degraded 为 continued 的提问。 */
  async function answerContinued(pending: PendingQuestion, answer: QuestionAnswer[]): Promise<void> {
    const callId = pending.callId
    if (userQuestions === undefined || callId === null || callId === '') {
      dropPending(pending)
      return
    }
    try {
      const accepted = userQuestions.answer(pending.agent, callId, { answers: answer })
      if (accepted !== true) {
        // 已在别处作答，或不再是 continued：静默退休。
        dropPending(pending)
        return
      }
    } catch (error) {
      if (codeOf(error) === 'BAD_ANSWER') {
        void delivery.sendControlText(
          `回答格式没对上（共 ${pending.questions.length} 题），请按每题一行重新回复。[${pending.tag}]`,
        )
        return
      }
      logger.warn(`secretary: answer() failed: ${error instanceof Error ? error.message : String(error)}`)
      dropPending(pending)
      return
    }
    dropPending(pending)
  }

  return {
    async onQuestions(request, next) {
      const config = readConfig()
      const agent = request.agent
      const sessionId = sessionIdOf(agent)
      const list = Array.isArray(request.questions) && request.questions.length > 0
        ? request.questions
        : null
      if (config.notifyQuestion !== true || sessionId === null || list === null) {
        return next()
      }
      if (skipSession(sessionId)) return next()

      const tag = mintTag()
      const pending: PendingQuestion = {
        kind: 'question',
        tag,
        sessionId,
        label: options.titleOf(sessionId) ?? sessionLabel(agent?.session),
        callId: request.wait?.callId ?? request.callId ?? null,
        questions: list,
        agent,
        phase: 'one',
        settled: false,
        resolveReply: null,
        timer: null,
      }
      questions.set(tag, pending)
      trimMap(questions)
      armTtl(pending)

      dispatch({
        sessionId,
        tag,
        title: '需要你回答',
        body: renderQuestions(list, tag, maxCharsOf(config), pending.label),
      })

      const reply = new Promise<QuestionAnswer[]>((resolve) => { pending.resolveReply = resolve })
      const native = holdWhenNoProvider(Promise.resolve().then(next))
      try {
        const outcome = await raceReply({ reply, native, signal: request.signal })
        dropPending(pending)
        return outcome.source === 'im' ? { answers: outcome.value } : outcome.value as UserQuestionsAnswer | undefined
      } catch (error) {
        if (request.signal?.aborted === true) {
          // 前台窗口关闭（timed 提问）或其它界面已作答 → 转入阶段二。
          pending.phase = 'two'
          throw error
        }
        dropPending(pending)
        throw error
      }
    },

    async onApproval(request, next) {
      const config = readConfig()
      const agent = request.agent
      const sessionId = sessionIdOf(agent)
      if (config.notifyApproval !== true || sessionId === null) return next()
      if (skipSession(sessionId)) return next()

      const reason = approvalReasonOf(request)
      const tag = mintTag()
      const pending: PendingApproval = {
        kind: 'approval',
        tag,
        sessionId,
        label: options.titleOf(sessionId) ?? sessionLabel(agent?.session),
        settled: false,
        resolve: null,
        timer: null,
      }
      approvals.set(tag, pending)
      trimMap(approvals)
      armTtl(pending)

      dispatch({
        sessionId,
        tag,
        title: '等待审批',
        body: renderApproval(
          { toolName: request.toolName ?? '', reason, argsSummary: '' },
          tag,
          maxCharsOf(config),
          pending.label,
        ),
      })

      const reply = new Promise<ApprovalDecision>((resolve) => { pending.resolve = resolve })
      const native = holdWhenNoProvider(Promise.resolve().then(next))
      try {
        const outcome = await raceReply({ reply, native, signal: request.signal })
        dropPending(pending)
        if (outcome.source === 'im') {
          void delivery.sendControlText(outcome.value === 'allowed-once'
            ? `✅ 已批准（仅本次有效）。[${pending.tag}]`
            : `🚫 已拒绝此次操作。[${pending.tag}]`)
          return outcome.value
        }
        return outcome.value as ApprovalOutcomeLike
      } catch (error) {
        dropPending(pending)
        throw error
      }
    },

    onInboxClaimed(payload) {
      if (questions.size === 0 && approvals.size === 0) return
      const message = payload?.message
      if (typeof message?.id !== 'string' || message.id === '') return
      const text = messageText(message)
      if (text.trim() === '') return
      const routed = routeReply({ text, questions, approvals })
      if (routed === null) return
      if (discarded.has(message.id)) return

      if (routed.kind === 'approval') {
        const pending = approvals.get(routed.tag)
        if (pending === undefined || pending.settled) return
        rememberDiscarded(message.id, routed.tag)
        dropPending(pending)
        pending.resolve?.(routed.decision)
        return
      }

      const pending = questions.get(routed.tag)
      if (pending === undefined || pending.settled) return
      rememberDiscarded(message.id, routed.tag)
      if (pending.phase === 'one') {
        // 阶段一：waterfall 仍在等，onQuestions 负责收尾并清理待办表。
        pending.settled = true
        pending.resolveReply?.(routed.answer)
        return
      }
      void answerContinued(pending, routed.answer)
    },

    async onPreStep(payload, next) {
      if (discarded.size === 0) return next()
      const decision = await next()
      if (decision.kind !== 'enter') return decision
      const filtered = decision.messages.filter((message) => {
        const id = typeof message?.id === 'string' ? message.id : undefined
        if (id === undefined || !discarded.has(id)) return true
        discarded.delete(id)
        return false
      })
      if (filtered.length === decision.messages.length) return decision
      if (filtered.length > 0) return { ...decision, messages: filtered }
      // 消息被清空：step 1 直接跑（等同「回合已完成」），否则拒绝这一步，
      // 避免把空消息列表提交给模型。
      return payload?.step === 1 ? { ...decision, messages: [] } : { kind: 'reject' }
    },

    setUserQuestions(service) {
      userQuestions = service
    },

    dispose() {
      for (const pending of [...questions.values(), ...approvals.values()]) dropPending(pending)
      questions.clear()
      approvals.clear()
      discarded.clear()
    },
  }
}
