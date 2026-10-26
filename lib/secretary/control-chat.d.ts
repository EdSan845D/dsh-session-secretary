/**
 * 控制聊天：秘书通知与代答回复的落点。
 *
 * v2 不再依赖 dsh-im 的目标管理——控制聊天就是「用户跟机器人说话的那个聊天」：
 * - 显式配置 `secretary.controlChatId`（格式 `渠道id:聊天id`，如 `qq:12345`）优先；
 * - 未配置时**自动学习**第一条入站私聊（记住渠道与聊天 id，落盘重启不丢）；
 * - 解析失败（渠道未连接 / 尚无学习结果）返回 null，发送方静默跳过并告警一次。
 */
export interface ObservedInbound {
    channelId: string;
    chatId: string;
    kind?: string;
}
export interface LearnedChat {
    channelId: string;
    chatId: string;
    at: string;
}
export interface ControlChatLogger {
    warn(message: string): void;
}
export interface ControlChatOptions {
    /** `渠道id:聊天id`；空串表示自动学习。 */
    controlChatId?: string;
    /** 学习结果落盘文件；null = 仅内存（测试用）。 */
    stateFile?: string | null;
    logger: ControlChatLogger;
    now?: () => Date;
}
export interface RunningChannel {
    id: string;
    send(chatId: string, text: string): Promise<void>;
}
export interface ControlTarget {
    channel: RunningChannel;
    chatId: string;
}
/** 解析 `渠道id:聊天id`（渠道 id 不含冒号，首个冒号即分隔）。 */
export declare function parseControlChatId(value: string | undefined): {
    channelId: string;
    chatId: string;
} | null;
export declare function createControlChat(options: ControlChatOptions): {
    /** 入站观察：未配置时学习第一条 DM 作为控制聊天（已学习则忽略）。 */
    observe(msg: ObservedInbound): void;
    /** 从运行中的渠道解析投递目标；不可用时返回 null。 */
    resolve(channels: Iterable<RunningChannel>): ControlTarget | null;
    /** 渠道重连等场景下清除「渠道缺失」的一次性告警。 */
    resetWarn(): void;
};
export type ControlChat = ReturnType<typeof createControlChat>;
//# sourceMappingURL=control-chat.d.ts.map