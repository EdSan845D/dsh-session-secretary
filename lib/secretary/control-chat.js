/**
 * 控制聊天：秘书通知与代答回复的落点。
 *
 * v2 不再依赖 dsh-im 的目标管理——控制聊天就是「用户跟机器人说话的那个聊天」：
 * - 显式配置 `secretary.controlChatId`（格式 `渠道id:聊天id`，如 `qq:12345`）优先；
 * - 未配置时**自动学习**第一条入站私聊（记住渠道与聊天 id，落盘重启不丢）；
 * - 解析失败（渠道未连接 / 尚无学习结果）返回 null，发送方静默跳过并告警一次。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
/** 解析 `渠道id:聊天id`（渠道 id 不含冒号，首个冒号即分隔）。 */
export function parseControlChatId(value) {
    if (typeof value !== 'string' || value === '')
        return null;
    const index = value.indexOf(':');
    if (index <= 0 || index === value.length - 1)
        return null;
    return { channelId: value.slice(0, index), chatId: value.slice(index + 1) };
}
export function createControlChat(options) {
    const logger = options.logger;
    const now = options.now ?? (() => new Date());
    let learned = options.stateFile === null || options.stateFile === undefined ? null : load(options.stateFile);
    let warnedOnce = false;
    function load(file) {
        try {
            if (!existsSync(file))
                return null;
            const raw = JSON.parse(readFileSync(file, 'utf8'));
            const learned = raw.learned;
            return learned !== null && typeof learned === 'object'
                && typeof learned.channelId === 'string' && learned.channelId !== ''
                && typeof learned.chatId === 'string' && learned.chatId !== ''
                ? learned
                : null;
        }
        catch {
            return null;
        }
    }
    function persist() {
        const file = options.stateFile;
        if (file === null || file === undefined || learned === null)
            return;
        try {
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, JSON.stringify({ learned }, null, 2), 'utf8');
        }
        catch {
            // 学习结果写盘失败不影响主流程：下次入站会重新学习
        }
    }
    return {
        /** 入站观察：未配置时学习第一条 DM 作为控制聊天（已学习则忽略）。 */
        observe(msg) {
            if (learned !== null)
                return;
            if (msg.kind !== 'dm')
                return;
            if (typeof msg.channelId !== 'string' || msg.channelId === ''
                || typeof msg.chatId !== 'string' || msg.chatId === '')
                return;
            learned = { channelId: msg.channelId, chatId: msg.chatId, at: now().toISOString() };
            persist();
            logger.warn(`secretary: 控制聊天已自动学习（${msg.channelId}:${msg.chatId}）；可用 secretary.controlChatId 固定`);
        },
        /** 从运行中的渠道解析投递目标；不可用时返回 null。 */
        resolve(channels) {
            const configured = parseControlChatId(options.controlChatId);
            const wanted = configured ?? (learned === null ? null : { channelId: learned.channelId, chatId: learned.chatId });
            if (wanted === null) {
                if (!warnedOnce) {
                    warnedOnce = true;
                    logger.warn('secretary: 尚无控制聊天（等待第一条入站私聊，或配置 secretary.controlChatId 为 `渠道id:聊天id`）');
                }
                return null;
            }
            for (const channel of channels) {
                if (channel.id === wanted.channelId)
                    return { channel, chatId: wanted.chatId };
            }
            if (!warnedOnce) {
                warnedOnce = true;
                logger.warn(`secretary: 控制聊天所属渠道 ${wanted.channelId} 未连接，通知暂不可用`);
            }
            return null;
        },
        /** 渠道重连等场景下清除「渠道缺失」的一次性告警。 */
        resetWarn() {
            warnedOnce = false;
        },
    };
}
//# sourceMappingURL=control-chat.js.map