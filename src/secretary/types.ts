/**
 * 秘书能力的外部契约（窄接口 + 事件声明合并）。
 *
 * 本插件用到的四个宿主扩展点里，`approval/request`（dsh-user-approval）、
 * `agent/inbox/claimed` 与 `agent/pre-step`（dsh-agent）、`api-session/error`
 * （dsh-api-session-controller）**官方类型面已声明**，这里**不重复合并** ——
 * 重复声明会与官方签名形成重载，参数变成 union，反而到处报错。
 *
 * 只有 `user-questions/request` 官方没声明（它只出现在 dsh-api-remotes 的远程
 * 事件表里），因此下面只补这一个事件，形状按 DSH 0.2.1-rc.3 桌面版实测定义。
 */

/** 宿主 aborted 信号的最小面（秘书只关心 abort 与 reason）。 */
export interface AbortSignalLike {
  aborted: boolean
  reason?: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

/** 提问项（`ask_user_question` 的题目）。 */
export interface SecretaryQuestion {
  id?: string
  header?: string
  question?: string
  detail?: string
  multiSelect?: boolean
  options?: Array<{ label?: string; description?: string }>
}

/** 单题答案：选中的选项标签 + 自由文本（与 dsh-im 的作答结构一致）。 */
export interface QuestionAnswer {
  id?: string
  selected: string[]
  custom?: string
}

/** 审批结论（dsh 的 `ApprovalDecision` 子集：本插件只产生这两种）。 */
export type ApprovalDecision = 'allowed-once' | 'rejected'

/**
 * 审批 waterfall 的完整结论集（与官方 `ApprovalOutcome` 同构）。
 *
 * 本插件只会**产出**前两种；后两种可能由其它应答方经 `next()` 给出，
 * 秘书必须原样放行，因此签名用完整集合而不是自己的子集。
 */
export type ApprovalOutcomeLike = ApprovalDecision | 'cancelled' | 'unavailable'

/** 代理对象的最小面（会话与 id）。 */
export interface SecretaryAgent {
  id?: string
  session?: {
    id?: string
    /** 会话头：`origin === 'subagent'` 为子代理，`cwd` 用于生成会话标签。 */
    header?: { origin?: string; cwd?: string; id?: string }
  }
}

/** `user-questions/request` 的请求体。 */
export interface UserQuestionsRequest {
  agent?: SecretaryAgent
  questions?: SecretaryQuestion[]
  signal?: AbortSignalLike
  /** timed 模式下携带待答 callId（`answer()` 需要它）。 */
  wait?: { callId?: string }
  callId?: string
}

/** `user-questions/request` 的作答结果。 */
export interface UserQuestionsAnswer {
  answers: QuestionAnswer[]
}

/**
 * `approval/request` 的请求体（官方 `ApprovalRequestEvent` 的**结构子集**）。
 *
 * ⚠️ `displayReason` 在官方是**按语种索引的对象**（`{ en, zh, … }`），
 * 不是字符串 —— 早期版本按字符串处理过，取值时要按对象挑语种。
 */
export interface ApprovalRequest {
  agent?: SecretaryAgent
  toolName?: string
  callId?: string
  reason?: string
  displayReason?: { en?: string; [locale: string]: string | undefined }
  signal?: AbortSignalLike
}

/** `agent/pre-step` 的载荷（秘书只关心 step 与 messages）。 */
export interface PreStepPayload {
  step?: number
  messages?: Array<{ id?: string }>
  [key: string]: unknown
}

/** `agent/inbox/claimed` 的载荷：一条被代理认领的入站消息。 */
export interface InboxClaimed {
  agent?: SecretaryAgent
  message?: {
    id?: string
    content?: readonly unknown[]
  }
  turn?: number
}

/** `ctx.userQuestions` 服务（continued 阶段的唯一作答入口）。 */
export interface UserQuestionsService {
  answer(agent: unknown, callId: string, payload: { answers: QuestionAnswer[] }): boolean
}

/** 控制聊天投递面（v2 经本插件自有渠道直发，替代 v1 的 dshIm 服务）。 */
export interface ControlDelivery {
  sendControlText(text: string): Promise<boolean>
}

/** `agent/pre-step` 的决策（官方 union 的结构子集：本桥只透传或改写 messages）。 */
export type PreStepDecision =
  | { kind: 'enter'; messages: Array<{ id?: string }>; [key: string]: unknown }
  | { kind: 'reject'; [key: string]: unknown }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 提问/审批作答服务（continued 阶段使用；缺席时秘书不接管提问）。 */
    userQuestions?: UserQuestionsService
  }

  interface Events {
    /**
     * 提问拦截点：模型的 `ask_user_question` 需要一个答案。
     *
     * 官方类型面尚未声明此事件（只在 `dsh-api-remotes` 的远程事件表里出现），
     * 形状按运行时实测定义：`wait.callId` 是 timed 提问降级后的作答凭据。
     * @mode waterfall
     */
    'user-questions/request'(
      request: UserQuestionsRequest,
      next: () => Promise<UserQuestionsAnswer | undefined>,
    ): unknown
  }
}
