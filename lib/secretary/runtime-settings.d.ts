/**
 * 秘书运行时设置：宿主 Config 默认值 + 设置页保存的覆盖层合并。
 *
 * 为什么不直接写宿主 Config：设置页保存要「即改即生效」，而 Config 变更会触发宿主
 * 插件重载（代答桥/全局监听全部重建，代价大且闪断）。这里沿用 sidebar-entry /
 * online-update 的先例——覆盖层落在 channels.json（store.secretary），桥与事件监听
 * 的闭包改读合并结果，保存后下一条消息/事件即生效，无需重载。
 */
/** 代笔回复有效期范围（分钟）：1 分钟 ~ 7 天。 */
export declare const PENDING_TTL_RANGE: {
    readonly min: 1;
    readonly max: 10080;
};
/** 转发截断长度范围（字符）。 */
export declare const MAX_FORWARD_CHARS_RANGE: {
    readonly min: 200;
    readonly max: 8000;
};
/** 秘书运行时生效值：Config 的 secretary 组 + system.enabled（页面可直接开关）。 */
export interface SecretarySettings {
    notifyQuestion: boolean;
    notifyApproval: boolean;
    notifyCompletion: boolean;
    notifyError: boolean;
    labelPrefix: boolean;
    intentParse: boolean;
    controlChatId: string;
    pendingTtlMinutes: number;
    maxForwardChars: number;
    systemEnabled: boolean;
}
/** defaults 未注入时的兜底（与 Config schema 默认值保持一致）。 */
export declare const SECRETARY_DEFAULTS: SecretarySettings;
/**
 * 只接受已知且类型正确的覆盖键；脏数据（手改文件/旧版本残留）静默丢弃，
 * 保证合并结果恒为完整合法的 SecretarySettings。
 */
export declare function mergeSecretarySettings(defaults: SecretarySettings, overrides: Record<string, unknown> | undefined): SecretarySettings;
export type SecretaryPatchResult = {
    ok: true;
    patch: Partial<SecretarySettings>;
} | {
    ok: false;
    error: string;
};
/**
 * 设置页 POST 补丁校验：未知键拒绝，数值字段限定范围。
 * `reset`（清除控制聊天学习）不属于设置项，由 API 层先行处理。
 */
export declare function normalizeSecretaryPatch(input: unknown): SecretaryPatchResult;
//# sourceMappingURL=runtime-settings.d.ts.map