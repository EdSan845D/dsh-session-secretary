/**
 * 秘书运行时设置：宿主 Config 默认值 + 设置页保存的覆盖层合并。
 *
 * 为什么不直接写宿主 Config：设置页保存要「即改即生效」，而 Config 变更会触发宿主
 * 插件重载（代答桥/全局监听全部重建，代价大且闪断）。这里沿用 sidebar-entry /
 * online-update 的先例——覆盖层落在 channels.json（store.secretary），桥与事件监听
 * 的闭包改读合并结果，保存后下一条消息/事件即生效，无需重载。
 */
/** 代笔回复有效期范围（分钟）：1 分钟 ~ 7 天。 */
export const PENDING_TTL_RANGE = { min: 1, max: 10_080 };
/** 转发截断长度范围（字符）。 */
export const MAX_FORWARD_CHARS_RANGE = { min: 200, max: 8000 };
/** defaults 未注入时的兜底（与 Config schema 默认值保持一致）。 */
export const SECRETARY_DEFAULTS = {
    notifyQuestion: true,
    notifyApproval: true,
    notifyCompletion: true,
    notifyError: true,
    labelPrefix: true,
    intentParse: true,
    controlChatId: '',
    pendingTtlMinutes: 1440,
    maxForwardChars: 1200,
    systemEnabled: true,
};
const BOOLEAN_KEYS = [
    'notifyQuestion', 'notifyApproval', 'notifyCompletion', 'notifyError',
    'labelPrefix', 'intentParse', 'systemEnabled',
];
/** POST 补丁允许的键；`reset`（清学习）由 API 层剥离，不在其中。 */
const SECRETARY_PATCH_KEYS = new Set([...BOOLEAN_KEYS, 'controlChatId', 'pendingTtlMinutes', 'maxForwardChars']);
/**
 * 只接受已知且类型正确的覆盖键；脏数据（手改文件/旧版本残留）静默丢弃，
 * 保证合并结果恒为完整合法的 SecretarySettings。
 */
export function mergeSecretarySettings(defaults, overrides) {
    const merged = { ...defaults };
    if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides))
        return merged;
    for (const key of BOOLEAN_KEYS) {
        if (typeof overrides[key] === 'boolean')
            merged[key] = overrides[key];
    }
    if (typeof overrides.controlChatId === 'string')
        merged.controlChatId = overrides.controlChatId;
    const ttl = overrides.pendingTtlMinutes;
    if (typeof ttl === 'number' && Number.isFinite(ttl) && ttl >= PENDING_TTL_RANGE.min && ttl <= PENDING_TTL_RANGE.max) {
        merged.pendingTtlMinutes = ttl;
    }
    const chars = overrides.maxForwardChars;
    if (typeof chars === 'number' && Number.isFinite(chars) && chars >= MAX_FORWARD_CHARS_RANGE.min && chars <= MAX_FORWARD_CHARS_RANGE.max) {
        merged.maxForwardChars = chars;
    }
    return merged;
}
/**
 * 设置页 POST 补丁校验：未知键拒绝，数值字段限定范围。
 * `reset`（清除控制聊天学习）不属于设置项，由 API 层先行处理。
 */
export function normalizeSecretaryPatch(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input))
        return { ok: false, error: '请求体必须是对象' };
    const source = input;
    for (const key of Object.keys(source)) {
        if (!SECRETARY_PATCH_KEYS.has(key))
            return { ok: false, error: `未知设置项：${key}` };
    }
    const patch = {};
    for (const key of BOOLEAN_KEYS) {
        if (!(key in source))
            continue;
        const value = source[key];
        if (typeof value !== 'boolean')
            return { ok: false, error: `${key} 必须是布尔值` };
        patch[key] = value;
    }
    if ('controlChatId' in source) {
        const value = source.controlChatId;
        if (typeof value !== 'string')
            return { ok: false, error: 'controlChatId 必须是字符串' };
        const trimmed = value.trim();
        if (trimmed !== '' && parseControlChatShape(trimmed) === null)
            return { ok: false, error: 'controlChatId 格式应为 `渠道id:聊天id`' };
        patch.controlChatId = trimmed;
    }
    if ('pendingTtlMinutes' in source) {
        const value = source.pendingTtlMinutes;
        if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)
            || value < PENDING_TTL_RANGE.min || value > PENDING_TTL_RANGE.max) {
            return { ok: false, error: `pendingTtlMinutes 必须是 ${PENDING_TTL_RANGE.min} ~ ${PENDING_TTL_RANGE.max} 的整数（分钟）` };
        }
        patch.pendingTtlMinutes = value;
    }
    if ('maxForwardChars' in source) {
        const value = source.maxForwardChars;
        if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)
            || value < MAX_FORWARD_CHARS_RANGE.min || value > MAX_FORWARD_CHARS_RANGE.max) {
            return { ok: false, error: `maxForwardChars 必须是 ${MAX_FORWARD_CHARS_RANGE.min} ~ ${MAX_FORWARD_CHARS_RANGE.max} 的整数（字符）` };
        }
        patch.maxForwardChars = value;
    }
    return { ok: true, patch };
}
function parseControlChatShape(value) {
    const index = value.indexOf(':');
    if (index <= 0 || index === value.length - 1)
        return null;
    return { channelId: value.slice(0, index), chatId: value.slice(index + 1) };
}
//# sourceMappingURL=runtime-settings.js.map