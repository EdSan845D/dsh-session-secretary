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
import { renderApproval } from './approval-text.js';
import { renderQuestions } from './reply-text.js';
import { messageText, newTag, routeReply } from './routing.js';
/** 待办表上限（长时间运行下防无界增长）。 */
const PENDING_LIMIT = 200;
/** 已消费回复的记录上限：只在 pre-step 过滤时需要，用掉即弃。 */
const DISCARDED_LIMIT = 200;
/** 审批 TTL 上限（分钟）：工具调用不该无限期挂起。 */
const APPROVAL_TTL_CAP_MINUTES = 60;
/** IM 回复与原生应答赛跑，并监听 abort（前台窗口关闭 = 转入阶段二）。 */
function raceReply(input) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
            settled = true;
            input.signal?.removeEventListener('abort', onAbort);
        };
        const onAbort = () => {
            if (settled)
                return;
            finish();
            reject(new Error('interaction aborted'));
        };
        input.signal?.addEventListener('abort', onAbort, { once: true });
        input.reply.then((value) => {
            if (settled)
                return;
            finish();
            resolve({ source: 'im', value });
        }, () => undefined);
        input.native.then((value) => {
            if (settled)
                return;
            finish();
            resolve({ source: 'native', value });
        }, (error) => {
            if (settled)
                return;
            finish();
            reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
}
/** 错误码提取（宿主用 `{ code }` 形态抛错）。 */
function codeOf(error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        return String(error.code);
    }
    return '';
}
/**
 * 原生应答缺席时挂住 waterfall。
 *
 * `NO_PROVIDER` 是宿主的**预期状态**（没有客户端应答器），不是错误：
 * 此时把 Promise 永久挂起，等 IM 回复来解开，而不是让工具调用失败。
 */
function holdWhenNoProvider(native) {
    return native.catch((error) => {
        if (codeOf(error) === 'NO_PROVIDER')
            return new Promise(() => undefined);
        throw error;
    });
}
/** 会话标签（cwd 末段；无则由渲染层显示「未命名」）。 */
function sessionLabel(session) {
    const cwd = session?.header?.cwd;
    if (typeof cwd === 'string' && cwd.trim() !== '') {
        const parts = cwd.split(/[\\/]/).filter(part => part !== '');
        const last = parts[parts.length - 1];
        if (typeof last === 'string' && last !== '')
            return last;
    }
    return '';
}
/**
 * 审批原因：`reason` 缺失时退回本地化的 `displayReason`。
 *
 * ⚠️ `displayReason` 是**按语种索引的对象**（`{ en, zh, … }`）而不是字符串，
 * 取中文优先、英文兜底，都没有时取第一个字符串值。
 */
function approvalReasonOf(request) {
    const reason = request.reason;
    if (typeof reason === 'string' && reason.trim() !== '')
        return reason.trim();
    const display = request.displayReason;
    if (display === undefined)
        return '';
    const zh = display.zh;
    if (typeof zh === 'string' && zh !== '')
        return zh;
    const en = display.en;
    if (typeof en === 'string' && en !== '')
        return en;
    for (const value of Object.values(display)) {
        if (typeof value === 'string' && value !== '')
            return value;
    }
    return '';
}
/** 根会话判定：子代理不转发（与通知侧「仅根会话」一致）。 */
function isRootSession(session) {
    return session?.header?.origin !== 'subagent';
}
/**
 * 装配秘书桥。所有依赖以函数注入：配置与通道都**用时求值**，
 * 这样设置页改配置能立刻生效（与调度器同一套约定）。
 */
export function createSecretaryBridge(options) {
    const { readConfig, delivery, dispatch, logger } = options;
    const random = options.random ?? Math.random;
    const questions = new Map();
    const approvals = new Map();
    /** 已消费的入站消息 id → 标签（pre-step 据此丢弃）。 */
    const discarded = new Map();
    let userQuestions;
    function dropPending(pending) {
        if (pending.timer !== null) {
            clearTimeout(pending.timer);
            pending.timer = null;
        }
        pending.settled = true;
        questions.delete(pending.tag);
        approvals.delete(pending.tag);
    }
    function trimMap(map) {
        if (map.size <= PENDING_LIMIT)
            return;
        const oldest = map.keys().next();
        if (oldest.done !== true)
            map.delete(oldest.value);
    }
    function rememberDiscarded(messageId, tag) {
        discarded.set(messageId, tag);
        while (discarded.size > DISCARDED_LIMIT) {
            const oldest = discarded.keys().next();
            if (oldest.done === true)
                break;
            discarded.delete(oldest.value);
        }
    }
    /** 挂上 TTL：审批有 60 分钟上限，超时自动拒绝。 */
    function armTtl(pending) {
        const minutes = Number(readConfig().pendingTtlMinutes);
        const effective = pending.kind === 'approval'
            ? Math.min(APPROVAL_TTL_CAP_MINUTES, Math.max(1, minutes > 0 ? minutes : 60))
            : Math.max(1, minutes > 0 ? minutes : 1440);
        pending.timer = setTimeout(() => {
            const isApproval = pending.kind === 'approval';
            const resolve = isApproval ? pending.resolve : null;
            dropPending(pending);
            if (isApproval) {
                resolve?.('rejected');
                void delivery.sendControlText(`⏰ 审批已超时，已自动拒绝此次操作。[${pending.tag}]`);
            }
        }, effective * 60_000);
        pending.timer.unref?.();
    }
    function mintTag() {
        let tag = newTag(random);
        while (questions.has(tag) || approvals.has(tag))
            tag = newTag(random);
        return tag;
    }
    /** 命中待办后的消费动作；messageId 非空时记录 pre-step 丢弃（网关截断路径为 null）。 */
    function consumeRouted(routed, messageId) {
        if (routed.kind === 'approval') {
            const pending = approvals.get(routed.tag);
            if (pending === undefined || pending.settled)
                return;
            if (messageId !== null)
                rememberDiscarded(messageId, routed.tag);
            dropPending(pending);
            pending.resolve?.(routed.decision);
            return;
        }
        const pending = questions.get(routed.tag);
        if (pending === undefined || pending.settled)
            return;
        if (messageId !== null)
            rememberDiscarded(messageId, routed.tag);
        if (pending.phase === 'one') {
            // 阶段一：waterfall 仍在等，onQuestions 负责收尾并清理待办表。
            pending.settled = true;
            pending.resolveReply?.(routed.answer);
            return;
        }
        void answerContinued(pending, routed.answer);
    }
    function sessionIdOf(agent) {
        const id = agent?.session?.id ?? agent?.id;
        if (typeof id !== 'string' || id === '')
            return null;
        if (!isRootSession(agent?.session))
            return null;
        return id;
    }
    /** 已绑定到聊天的会话由原生引擎接管（提问/审批按钮），桥跳过避免抢答。 */
    function skipSession(sessionId) {
        return options.isSessionBound(sessionId);
    }
    function maxCharsOf(config) {
        const value = Number(config.maxForwardChars);
        return value > 0 ? value : 1200;
    }
    /** 阶段二作答：把回复补进已经 degraded 为 continued 的提问。 */
    async function answerContinued(pending, answer) {
        const callId = pending.callId;
        if (userQuestions === undefined || callId === null || callId === '') {
            dropPending(pending);
            return;
        }
        try {
            const accepted = userQuestions.answer(pending.agent, callId, { answers: answer });
            if (accepted !== true) {
                // 已在别处作答，或不再是 continued：静默退休。
                dropPending(pending);
                return;
            }
        }
        catch (error) {
            if (codeOf(error) === 'BAD_ANSWER') {
                void delivery.sendControlText(`回答格式没对上（共 ${pending.questions.length} 题），请按每题一行重新回复。[${pending.tag}]`);
                return;
            }
            logger.warn(`secretary: answer() failed: ${error instanceof Error ? error.message : String(error)}`);
            dropPending(pending);
            return;
        }
        dropPending(pending);
    }
    return {
        async onQuestions(request, next) {
            const config = readConfig();
            const agent = request.agent;
            const sessionId = sessionIdOf(agent);
            const list = Array.isArray(request.questions) && request.questions.length > 0
                ? request.questions
                : null;
            if (config.notifyQuestion !== true || sessionId === null || list === null) {
                return next();
            }
            if (skipSession(sessionId))
                return next();
            const tag = mintTag();
            const pending = {
                kind: 'question',
                tag,
                sessionId,
                label: options.titleOf(sessionId) ?? sessionLabel(agent?.session),
                callId: request.wait?.callId ?? request.callId ?? null,
                questions: list,
                agent,
                phase: 'one',
                settled: false,
                resolveReply: null,
                timer: null,
            };
            questions.set(tag, pending);
            trimMap(questions);
            armTtl(pending);
            dispatch({
                sessionId,
                tag,
                title: '需要你回答',
                body: renderQuestions(list, tag, maxCharsOf(config), pending.label),
            });
            const reply = new Promise((resolve) => { pending.resolveReply = resolve; });
            const native = holdWhenNoProvider(Promise.resolve().then(next));
            try {
                const outcome = await raceReply({ reply, native, signal: request.signal });
                dropPending(pending);
                return outcome.source === 'im' ? { answers: outcome.value } : outcome.value;
            }
            catch (error) {
                if (request.signal?.aborted === true) {
                    // 前台窗口关闭（timed 提问）或其它界面已作答 → 转入阶段二。
                    pending.phase = 'two';
                    throw error;
                }
                dropPending(pending);
                throw error;
            }
        },
        async onApproval(request, next) {
            const config = readConfig();
            const agent = request.agent;
            const sessionId = sessionIdOf(agent);
            if (config.notifyApproval !== true || sessionId === null)
                return next();
            if (skipSession(sessionId))
                return next();
            const reason = approvalReasonOf(request);
            const tag = mintTag();
            const pending = {
                kind: 'approval',
                tag,
                sessionId,
                label: options.titleOf(sessionId) ?? sessionLabel(agent?.session),
                settled: false,
                resolve: null,
                timer: null,
            };
            approvals.set(tag, pending);
            trimMap(approvals);
            armTtl(pending);
            dispatch({
                sessionId,
                tag,
                title: '等待审批',
                body: renderApproval({ toolName: request.toolName ?? '', reason, argsSummary: '' }, tag, maxCharsOf(config), pending.label),
            });
            const reply = new Promise((resolve) => { pending.resolve = resolve; });
            const native = holdWhenNoProvider(Promise.resolve().then(next));
            try {
                const outcome = await raceReply({ reply, native, signal: request.signal });
                dropPending(pending);
                if (outcome.source === 'im') {
                    void delivery.sendControlText(outcome.value === 'allowed-once'
                        ? `✅ 已批准（仅本次有效）。[${pending.tag}]`
                        : `🚫 已拒绝此次操作。[${pending.tag}]`);
                    return outcome.value;
                }
                return outcome.value;
            }
            catch (error) {
                dropPending(pending);
                throw error;
            }
        },
        onInboxClaimed(payload) {
            if (questions.size === 0 && approvals.size === 0)
                return;
            const message = payload?.message;
            if (typeof message?.id !== 'string' || message.id === '')
                return;
            const text = messageText(message);
            if (text.trim() === '')
                return;
            const routed = routeReply({ text, questions, approvals });
            if (routed === null)
                return;
            if (discarded.has(message.id))
                return;
            consumeRouted(routed, message.id);
        },
        tryConsumeReply(text) {
            if (questions.size === 0 && approvals.size === 0)
                return false;
            const routed = routeReply({ text, questions, approvals });
            if (routed === null)
                return false;
            consumeRouted(routed, null);
            return true;
        },
        async onPreStep(payload, next) {
            if (discarded.size === 0)
                return next();
            const decision = await next();
            if (decision.kind !== 'enter')
                return decision;
            const filtered = decision.messages.filter((message) => {
                const id = typeof message?.id === 'string' ? message.id : undefined;
                if (id === undefined || !discarded.has(id))
                    return true;
                discarded.delete(id);
                return false;
            });
            if (filtered.length === decision.messages.length)
                return decision;
            if (filtered.length > 0)
                return { ...decision, messages: filtered };
            // 消息被清空：step 1 直接跑（等同「回合已完成」），否则拒绝这一步，
            // 避免把空消息列表提交给模型。
            return payload?.step === 1 ? { ...decision, messages: [] } : { kind: 'reject' };
        },
        setUserQuestions(service) {
            userQuestions = service;
        },
        dispose() {
            for (const pending of [...questions.values(), ...approvals.values()])
                dropPending(pending);
            questions.clear();
            approvals.clear();
            discarded.clear();
        },
    };
}
//# sourceMappingURL=bridge.js.map