import Schema from '@deepseek-ai/schemastery';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ChannelManager } from './manager.js';
import { createRotatingFileAppender } from './engine/file-log.js';
import { registerPluginUpdater } from './plugin-updater.js';
import { createImSessionId } from './engine/session-id.js';
// [secretary]
import { createControlChat } from './secretary/control-chat.js';
import { createLabelProvider } from './secretary/label.js';
import { createNotifier } from './secretary/notifier.js';
import { createSecretaryBridge } from './secretary/bridge.js';
import { buildIntentPrompt, candidateLines, parseIntentReply } from './secretary/intent.js';
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
        // v2.0：client 通知半边延期到 v2.1，桌面 toast 由本通道（node-notifier/SnoreToast）承担
        enabled: Schema.boolean().default(true),
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
    // tag 截断：先于原生流程消费秘书代笔回复；顺带学习控制聊天 + 意图解析
    const pendingIntents = new Map();
    const sendControl = async (text) => {
        const target = controlChat.resolve(manager.runningChannels);
        if (target === null)
            return;
        await target.channel.send(target.chatId, text).catch(error => {
            warnLog(`控制投递失败: ${error instanceof Error ? error.message : String(error)}`);
        });
    };
    const getController = () => ctx.get?.('sessionController');
    const sessionBaseName = (path) => {
        if (typeof path !== 'string' || path === '')
            return '';
        const parts = path.split(/[\\/]/).filter(part => part !== '');
        return parts.at(-1) ?? '';
    };
    const askAgentOnce = (intentSessionId, prompt, timeoutMs) => new Promise(resolve => {
        let settled = false;
        const finish = (value) => {
            if (settled)
                return;
            settled = true;
            off();
            clearTimeout(timer);
            resolve(value);
        };
        const off = ctx.on('session/event', (session, event) => {
            if (session?.id !== intentSessionId || event?.type !== 'assistant/message')
                return;
            if (event.surfaceOp !== undefined && event.surfaceOp !== 'append')
                return;
            const text = extractAssistantText(event.data);
            if (text.trim() !== '')
                finish(text);
        });
        const timer = setTimeout(() => finish(null), timeoutMs);
        timer.unref?.();
        const controller = getController();
        if (controller === undefined) {
            finish(null);
            return;
        }
        void controller.prompt({ sessionId: intentSessionId, requestId: randomUUID(), content: [{ type: 'text', text: prompt }] })
            .catch(() => finish(null));
    });
    const runIntent = async (channelId, kind, msg) => {
        const controller = getController();
        const agents = ctx.agents;
        if (controller === undefined || agents?.create === undefined)
            return null;
        const listed = await controller.list({}).catch(() => null);
        const rows = (listed?.items ?? []).filter(row => !row.origin && row.running !== true).slice(0, 8);
        const candidates = rows.map(row => ({
            sessionId: row.sessionId,
            title: row.projections?.values?.title || row.sessionId.slice(0, 8),
            project: sessionBaseName(row.cwd) || '未知项目',
        }));
        let handle;
        try {
            const intentSessionId = createImSessionId('secretary', kind, msg.chatId);
            handle = await agents.create({
                sessionId: intentSessionId,
                meta: { cwd: config.cwd || process.cwd() },
                agentOptions: { provider: config.provider, model: config.model },
            });
            const reply = await askAgentOnce(intentSessionId, buildIntentPrompt({ userText: msg.text, chatId: msg.chatId, candidates }), 25_000);
            const intent = reply === null ? null : parseIntentReply(reply, candidates);
            if (intent === null || intent.action === 'chat')
                return null;
            if (intent.action === 'open' && intent.sessionId !== undefined) {
                const row = rows.find(item => item.sessionId === intent.sessionId);
                const known = candidates.find(item => item.sessionId === intent.sessionId);
                const bind = async () => {
                    const resolved = await controller.resolveAgent(intent.sessionId).then(value => value?.agent).catch(() => undefined);
                    await manager.imEngine.bindSessionToChat(channelId, kind, msg.chatId, intent.sessionId, row?.projections?.values?.title || intent.sessionId, resolved, row?.cwd);
                    return `已切换：【${known?.project ?? ''}·${known?.title ?? ''}】。直接发消息即可。`;
                };
                return { confirmText: `${intent.reply}\n\n[1] 确认打开  [2] 取消`, options: [bind, async () => '已取消。'] };
            }
            if (intent.action === 'create') {
                const knownRow = intent.project === undefined ? undefined : rows.find(row => sessionBaseName(row.cwd) === intent.project);
                const cwd = knownRow?.cwd ?? (config.cwd || process.cwd());
                const create = async () => {
                    await manager.imEngine.createAndBindSession(channelId, kind, msg.chatId, '新会话', cwd);
                    return `已在「${cwd}」创建新会话。直接发消息即可。`;
                };
                return { confirmText: `${intent.reply}\n\n[1] 确认新建（${cwd}）  [2] 取消`, options: [create, async () => '已取消。'] };
            }
            // clarify：列候选让用户选
            if (candidates.length === 0)
                return null;
            return {
                confirmText: `${intent.reply || '请选择目标会话：'}\n\n${candidateLines(candidates).join('\n')}\n\n回复序号选择，或「取消」。`,
                options: candidates.map(item => async () => {
                    const row = rows.find(entry => entry.sessionId === item.sessionId);
                    const resolved = await controller.resolveAgent(item.sessionId).then(value => value?.agent).catch(() => undefined);
                    await manager.imEngine.bindSessionToChat(channelId, kind, msg.chatId, item.sessionId, item.title, resolved, row?.cwd);
                    return `已切换：【${item.project}·${item.title}】。直接发消息即可。`;
                }),
            };
        }
        catch (error) {
            warnLog(`意图解析失败: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
        finally {
            void handle?.dispose?.().catch(() => { });
        }
    };
    manager.imEngine.secretaryInbound = async (channelId, msg) => {
        controlChat.observe({ channelId, chatId: msg.chatId, kind: msg.kind });
        if (bridge.tryConsumeReply(msg.text))
            return true;
        const kind = msg.kind === 'group' ? 'group' : 'dm';
        const chatKey = `${channelId}:${kind}:${msg.chatId}`;
        const pending = pendingIntents.get(chatKey);
        if (pending !== undefined) {
            const pick = /^([1-9]\d*)$/.exec(msg.text.trim());
            if (pick !== null) {
                pendingIntents.delete(chatKey);
                const run = pending[Number(pick[1]) - 1];
                if (run === undefined) {
                    void sendControl('序号无效，请重新说明你的需求。');
                    return true;
                }
                const result = await run().catch(error => `执行失败：${error instanceof Error ? error.message : String(error)}`);
                void sendControl(result);
                return true;
            }
            if (/^(取消|算了|取消吧|no|cancel)$/i.test(msg.text.trim())) {
                pendingIntents.delete(chatKey);
                void sendControl('已取消。');
                return true;
            }
        }
        // 意图解析：仅私聊、非命令、无绑定、开关开启（有绑定 → 文本原生直达当前会话）
        if (kind !== 'dm' || msg.text.trim().startsWith('/') || config.secretary.intentParse !== true)
            return false;
        if (manager.imEngine.chatBound(channelId, kind, msg.chatId))
            return false;
        const intent = await runIntent(channelId, kind, msg).catch(() => null);
        if (intent === null)
            return false;
        pendingIntents.set(chatKey, intent.options);
        void sendControl(intent.confirmText);
        return true;
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