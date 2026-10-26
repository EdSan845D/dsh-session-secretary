import Schema from '@deepseek-ai/schemastery';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ChannelManager } from './manager.js';
import { createRotatingFileAppender } from './engine/file-log.js';
import { registerPluginUpdater } from './plugin-updater.js';
// [secretary]
import { createControlChat } from './secretary/control-chat.js';
import { createLabelProvider } from './secretary/label.js';
import { createNotifier } from './secretary/notifier.js';
import { createSecretaryBridge } from './secretary/bridge.js';
import { createSystemChannel } from './notify-channels/system.js';
export const name = 'dsh-session-secretary';
export const inject = [
    'webServer',
    'credentials',
    'agents',
    'agentPresets',
    'agentDefaultModel',
    'llm',
    'permissionPresets',
];
const notifyVerbosity = Schema.union(['minimal', 'normal', 'detailed']).default('normal');
export const Config = Schema.object({
    stateDir: Schema.string().default(''),
    cwd: Schema.string().default(process.cwd()),
    provider: Schema.string().default(''),
    model: Schema.string().default(''),
    agentPreset: Schema.string().default('standard'),
    mergeTimeoutSecs: Schema.number().default(5),
    topicNaming: Schema.union(['once', 'follow', 'off']).default('once'),
    updater: Schema.boolean().default(false),
    onlineUpdate: Schema.boolean().default(false),
    // [secretary]
    secretary: Schema.object({
        notifyQuestion: Schema.boolean().default(true),
        notifyApproval: Schema.boolean().default(true),
        notifyCompletion: Schema.boolean().default(true),
        notifyError: Schema.boolean().default(true),
        labelPrefix: Schema.boolean().default(true),
        intentParse: Schema.boolean().default(true),
        controlChatId: Schema.string().default(''),
        pendingTtlMinutes: Schema.number().default(1440),
        maxForwardChars: Schema.number().default(1200),
    }),
    system: Schema.object({
        enabled: Schema.boolean().default(false),
        icon: Schema.string(),
        verbosity: notifyVerbosity,
    }),
    browser: Schema.object({
        enabled: Schema.boolean().default(true),
        onlyWhenHidden: Schema.boolean().default(true),
        verbosity: notifyVerbosity,
    }),
});
export function apply(ctx, config) {
    const hostUpdateDisabled = config.updater === false || config.onlineUpdate === false;
    const permissionPresets = ctx.permissionPresets;
    const stateDir = config.stateDir !== ''
        ? config.stateDir
        : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-session-secretary');
    mkdirSync(stateDir, { recursive: true });
    const logFile = join(stateDir, 'gateway.log');
    const fileLog = createRotatingFileAppender(logFile);
    const log = (line) => {
        const stamped = `${new Date().toISOString()} ${line}`;
        ctx.logger(name).info(line);
        fileLog.append(`${stamped}\n`);
    };
    const engineConfig = {
        cwd: config.cwd || process.cwd(),
        provider: config.provider,
        model: config.model,
        agentPreset: config.agentPreset || 'standard',
        mergeTimeoutSecs: config.mergeTimeoutSecs || 5,
        permissionPreset: permissionPresets.defaultPreset,
        topicNaming: config.topicNaming ?? 'once',
    };
    const applyStarted = Date.now();
    const manager = new ChannelManager({ ctx, stateDir, log, engineConfig, hostUpdateDisabled });
    log(`[boot] ChannelManager 构造 ${Date.now() - applyStarted}ms`);
    // ── [secretary] 会话秘书：中断/完成通知 + IM 代答桥 ───────────────────
    wireSecretary(ctx, config, manager, log, stateDir);
    ctx.effect(() => registerPluginUpdater(ctx, {
        endpoint: '/api/michengai/dsh-im-connect/update',
        packageName: '@michengai/dsh-im-connect',
        manifestUrl: new URL('../package.json', import.meta.url),
        isEnabled: async () => !hostUpdateDisabled && manager.isUpdateEnabled(),
    }), 'im-connect.plugin-updater');
    ctx.effect(() => {
        manager.registerApi(ctx);
        // 卸载或初始化失败后不再恢复会话；保留一个完整异常链，避免后台拒绝终止宿主。
        void manager.initEnabled().then(() => manager.attachMappedSessions()).catch(error => {
            fileLog.append(`${new Date().toISOString()} [boot] 初始化失败: ${error instanceof Error ? error.message : String(error)}\n`);
        });
        log(`[boot] apply 完成 ${Date.now() - applyStarted}ms`);
        return () => { manager.disposeApi(); void fileLog.flush(); };
    }, 'im-connect.serve');
}
// [secretary] ─────────────────────────────────────────────────────────────
// 会话秘书装配：控制聊天学习、label 前缀、系统通道、两阶段代答桥、
// 完成/出错通知。全部依赖经 use-time 闭包读取，配置改后重载即生效。
/** 取助手消息的纯文本（事件 data.message.content 的 text 块拼接）。 */
function extractAssistantText(eventData) {
    const content = eventData?.message?.content;
    if (!Array.isArray(content))
        return '';
    return content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map(part => part.text)
        .join('\n');
}
function truncate(text, max = 300) {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
function wireSecretary(ctx, config, manager, log, stateDir) {
    const warnLog = (line) => log(`[secretary] ${line}`);
    const controlChat = createControlChat({
        controlChatId: config.secretary.controlChatId,
        stateFile: join(stateDir, 'control-chat.json'),
        logger: { warn: warnLog },
    });
    const systemChannel = config.system.enabled === true
        ? createSystemChannel(config.system.icon === undefined ? {} : { icon: config.system.icon })
        : undefined;
    const labelProvider = createLabelProvider({
        list: async () => {
            const controller = ctx.get?.('sessionController');
            if (controller === undefined)
                return null;
            return await controller.list({}).catch(() => null);
        },
    });
    manager.imEngine.applySessionLabel = async (text, sessionId) => {
        if (config.secretary.labelPrefix !== true)
            return text;
        const label = await labelProvider.labelOf(sessionId);
        return label === '' ? text : `${label}${text}`;
    };
    const notifier = createNotifier({
        control: () => controlChat.resolve(manager.runningChannels),
        system: systemChannel === undefined ? undefined : { send: payload => systemChannel.send(payload) },
        labelOf: sessionId => labelProvider.labelOf(sessionId),
        logger: { warn: warnLog },
    });
    const bridge = createSecretaryBridge({
        readConfig: () => config.secretary,
        delivery: {
            async sendControlText(text) {
                const target = controlChat.resolve(manager.runningChannels);
                if (target === null)
                    return false;
                try {
                    await target.channel.send(target.chatId, text);
                    return true;
                }
                catch (error) {
                    warnLog(`控制投递失败: ${error instanceof Error ? error.message : String(error)}`);
                    return false;
                }
            },
        },
        isSessionBound: sessionId => manager.imEngine.isSessionBound(sessionId),
        dispatch: signal => { void notifier.dispatchForward(signal); },
        titleOf: () => undefined,
        logger: { warn: warnLog },
    });
    bridge.setUserQuestions(ctx.userQuestions);
    // tag 截断：先于原生流程消费秘书代笔回复；顺带学习控制聊天
    manager.imEngine.secretaryInbound = async (channelId, msg) => {
        controlChat.observe({ channelId, chatId: msg.chatId, kind: msg.kind });
        return bridge.tryConsumeReply(msg.text);
    };
    // 四个扩展点全部 global：事件由宿主在根上下文派发（v1 已验证的同款接线）
    ctx.on('user-questions/request', (request, next) => bridge.onQuestions(request, next), { global: true });
    ctx.on('approval/request', (request, next) => bridge.onApproval(request, next), { global: true });
    ctx.on('agent/inbox/claimed', payload => bridge.onInboxClaimed(payload), { global: true });
    ctx.on('agent/pre-step', (payload, next) => bridge.onPreStep(payload, next), { global: true });
    // 会话事件：标题缓存失效 + 完成/出错通知（仅根会话且未绑定聊天，已绑定走原生结果通知）
    const lastAssistant = new Map();
    const rememberAssistant = (sessionId, text) => {
        if (lastAssistant.has(sessionId))
            lastAssistant.delete(sessionId);
        lastAssistant.set(sessionId, text);
        while (lastAssistant.size > 500) {
            const oldest = lastAssistant.keys().next();
            if (oldest.done === true)
                break;
            lastAssistant.delete(oldest.value);
        }
    };
    ctx.on('session/event', (session, event) => {
        if (event.type === 'session/title') {
            labelProvider.invalidate();
            return;
        }
        const sessionId = session?.id;
        if (typeof sessionId !== 'string' || sessionId === '')
            return;
        if (event.type === 'assistant/message') {
            const text = extractAssistantText(event.data);
            if (text.trim() !== '')
                rememberAssistant(sessionId, text.slice(0, 2000));
            return;
        }
        if (config.secretary.notifyCompletion !== true)
            return;
        if (event.type !== 'turn/end' || event.data?.reason?.kind !== 'completed')
            return;
        if (session.header?.origin === 'subagent')
            return;
        if (manager.imEngine.isSessionBound(sessionId))
            return;
        const summary = lastAssistant.get(sessionId)?.trim() || '（本回合没有文字输出）';
        void notifier.lifecycle(sessionId, '回合完成', `✅ 会话回合完成：${truncate(summary)}`);
    });
    ctx.on('agent/error', (payload) => {
        if (config.secretary.notifyError !== true)
            return;
        const sessionId = payload.agent?.session?.id ?? payload.agent?.id;
        if (typeof sessionId !== 'string' || sessionId === '')
            return;
        if (payload.agent?.session?.header?.origin === 'subagent')
            return;
        if (manager.imEngine.isSessionBound(sessionId))
            return;
        const message = payload.error instanceof Error ? payload.error.message : String(payload.error ?? '未知错误');
        void notifier.lifecycle(sessionId, '任务出错', `❌ 会话出错：${truncate(message.trim() || '未知错误')}`);
    });
    ctx.effect(() => () => {
        bridge.dispose();
        lastAssistant.clear();
    }, 'secretary bridge');
}
export { CHANNEL_META, CHANNEL_ORDER, listChannelMeta } from './channels/meta.js';
export { IM_ORIGIN, IM_SESSION_PREFIX, createImSessionId, isImOrigin, isImSessionId, isTaskSession, sessionKeyOf, } from './engine/session-id.js';
export { splitText } from './engine/split.js';
//# sourceMappingURL=index.js.map