import { randomUUID } from 'node:crypto';
/** IM 会话标识：与网页任务分列。DSH 会话头不能写 origin=im，只靠 id 前缀。 */
export const IM_ORIGIN = 'im';
/** 新会话统一为 dsh-<来源>-session-<UUID>，与自动化任务同族且不含路径非法字符。 */
export const IM_SESSION_PREFIX = 'dsh-im-session-';
/** 早期语义化 ID（含渠道、聊天类型与聊天目标），仅用于读取存量会话。 */
export const IM_SESSION_PREFIX_LEGACY = 'im:';
export function sessionKeyOf(channel, kind, chatId) {
    return `${channel}:${kind}:${chatId}`;
}
/**
 * 新建会话使用统一 UUID；渠道、聊天类型与聊天目标不再编入 id，
 * 归属以会话映射为准，避免第三方标识带出路径非法字符。
 */
export function createImSessionId() {
    return `${IM_SESSION_PREFIX}${randomUUID()}`;
}
/** 新旧两代前缀都算 IM 会话，存量会话升级后仍能被正确分类。 */
export function isImSessionId(sessionId) {
    return sessionId.startsWith(IM_SESSION_PREFIX) || sessionId.startsWith(IM_SESSION_PREFIX_LEGACY);
}
const CHANNEL_IDS = ['dingtalk', 'feishu', 'lark', 'weixin', 'wecom', 'qq', 'telegram', 'discord', 'slack'];
const STAMP_RE = /^\d{13,}$/;
/** 只解析早期语义化 ID；统一 UUID 不含业务字段，无法反解归属。 */
export function parseImSessionId(sessionId) {
    if (!sessionId.startsWith(IM_SESSION_PREFIX_LEGACY))
        return undefined;
    const rest = sessionId.slice(IM_SESSION_PREFIX_LEGACY.length);
    const first = rest.indexOf(':');
    const second = rest.indexOf(':', first + 1);
    if (first <= 0 || second <= first)
        return undefined;
    const channel = rest.slice(0, first);
    const kind = rest.slice(first + 1, second);
    let chatId = rest.slice(second + 1);
    const third = chatId.indexOf(':');
    if (third > 0 && STAMP_RE.test(chatId.slice(0, third))) {
        chatId = chatId.slice(third + 1);
    }
    const platform = channel.split('_', 1)[0];
    const validInstance = CHANNEL_IDS.includes(platform) && /^[a-z0-9_-]+$/.test(channel);
    if (!validInstance || (kind !== 'dm' && kind !== 'group') || chatId === '')
        return undefined;
    return { channel, kind, chatId };
}
export function isImOrigin(origin) {
    return origin === IM_ORIGIN;
}
/** 任务列表可见：排除 IM 与子 agent。 */
export function isTaskSession(input) {
    if (input.blank === true)
        return false;
    if (isImOrigin(input.origin))
        return false;
    if (typeof input.id === 'string' && isImSessionId(input.id))
        return false;
    if (input.origin === 'subagent')
        return false;
    return true;
}
//# sourceMappingURL=session-id.js.map