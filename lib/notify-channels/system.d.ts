/**
 * 系统通知通道：OS 级 toast（Windows / macOS / Linux），经 node-notifier 投递。
 *
 * 自 dsh-messager 移植。平台差异与降级策略：
 * - Windows：PowerShell ToastNotification（内建），sound 可靠；
 * - macOS / Linux：terminal-notifier / notify-send 无内建声音参数，不传 sound；
 * - icon 必须是存在的文件路径，无效时整段省略（三平台对非法路径都可能直接失败）；
 * - 发送失败时做一次「去掉图标」的重试，再交由调用方记录。
 */
export interface NotificationPayload {
    title: string;
    body: string;
}
export interface NotifyChannel {
    id: string;
    send(payload: NotificationPayload): Promise<void>;
}
export interface SystemChannelOptions {
    /** 图标绝对路径（node-notifier 需要文件路径且该文件必须存在）。 */
    icon?: string;
}
export declare function createSystemChannel(options?: SystemChannelOptions): NotifyChannel;
//# sourceMappingURL=system.d.ts.map