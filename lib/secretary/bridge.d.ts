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
import type { ApprovalOutcomeLike, ApprovalRequest, ControlDelivery, InboxClaimed, PreStepDecision, PreStepPayload, UserQuestionsAnswer, UserQuestionsRequest, UserQuestionsService } from './types.js';
/** 桥读取的配置面（index.ts 从 fork Config 的 secretary 组映射）。 */
export interface SecretaryBridgeConfig {
    notifyQuestion: boolean;
    notifyApproval: boolean;
    maxForwardChars: number;
    pendingTtlMinutes: number;
}
/** 秘书信号（交给调度器分发到所有已启用通道）。 */
export interface SecretaryDispatch {
    sessionId: string;
    tag: string;
    title: string;
    body: string;
}
export interface BridgeLogger {
    warn(message: string): void;
    debug?(message: string): void;
}
export interface SecretaryBridgeOptions {
    /** 每次用时读取的秘书配置（volatile 引用，绝不缓存快照）。 */
    readConfig: () => SecretaryBridgeConfig;
    /** 控制聊天投递（经本插件自有渠道直发）。 */
    delivery: ControlDelivery;
    /** 该会话是否已被原生绑定到一个聊天（绑定 → 原生引擎接管，桥跳过）。 */
    isSessionBound(sessionId: string): boolean;
    /** 秘书信号出口（经调度器分发到所有通道）。 */
    dispatch(signal: SecretaryDispatch): void;
    /** 会话 id → 会话标题（调度器持有）。 */
    titleOf(sessionId: string): string | undefined;
    logger: BridgeLogger;
    now?: () => number;
    /** 标签随机源（测试可注入）。 */
    random?: () => number;
}
export interface SecretaryBridge {
    onQuestions(request: UserQuestionsRequest, next: () => Promise<UserQuestionsAnswer | undefined>): Promise<UserQuestionsAnswer | undefined>;
    onApproval(request: ApprovalRequest, next: () => Promise<ApprovalOutcomeLike>): Promise<ApprovalOutcomeLike>;
    onInboxClaimed(payload: InboxClaimed): void;
    /**
     * 网关 tag 截断入口（gateway.secretaryInbound）：命中 pending 的回复就地消费，
     * 返回 true 表示已消费、网关不得再走原生流程。与 onInboxClaimed 的差别：
     * 消息未进 inbox，无需 pre-step 丢弃记录。
     */
    tryConsumeReply(text: string): boolean;
    onPreStep(payload: PreStepPayload, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>;
    /** 注入 `ctx.userQuestions` 服务（阶段二作答需要）。 */
    setUserQuestions(service: UserQuestionsService | undefined): void;
    dispose(): void;
}
/**
 * 装配秘书桥。所有依赖以函数注入：配置与通道都**用时求值**，
 * 这样设置页改配置能立刻生效（与调度器同一套约定）。
 */
export declare function createSecretaryBridge(options: SecretaryBridgeOptions): SecretaryBridge;
//# sourceMappingURL=bridge.d.ts.map