import type { Context } from '@deepseek-ai/cordis';
import type { ChannelInstanceId, ChatKind, SessionRecord } from './session-id.js';
import { SessionMapStore } from './session-store.js';
import type { EngineConfig, SendMode } from './types.js';
export interface ChatBinding {
    key: string;
    channelId: ChannelInstanceId;
    kind: ChatKind;
    chatId: string;
    sessionId: string;
    handle?: {
        agent?: unknown;
        dispose(): Promise<void>;
    };
}
type WorkspaceLookup = {
    list(): Array<{
        path: string;
        sessionIds?: readonly string[];
        attachSession(sessionId: string): Promise<void>;
    }>;
    archivedSessionIds?: readonly string[];
};
type PermissionPresetHost = {
    set(session: unknown, name: string): void;
};
type AgentHost = Context & {
    sessions?: {
        list(): readonly {
            readonly id: string;
        }[];
    };
    agents?: {
        create(opts: Record<string, unknown>): Promise<{
            agent?: {
                followup(message: unknown): void;
                session?: {
                    id?: string;
                };
            };
            dispose(): Promise<void>;
        }>;
        get?(id: string): {
            followup(message: unknown): void;
            session?: {
                id?: string;
            };
        } | undefined;
        resume?(opts: Record<string, unknown>): Promise<{
            agent?: {
                followup(message: unknown): void;
            };
            dispose(): Promise<void>;
        }>;
        withoutInitiator?<T>(operation: () => T): T;
    };
    get?(name: string): WorkspaceLookup | {
        list?: () => Promise<readonly {
            readonly id: string;
        }[]>;
    } | undefined;
    agentPresets?: {
        mount(agentCtx: unknown, presetId: string): Promise<void>;
        /** 探测预设可用性；旧版宿主可能没有该方法。 */
        resolve?(id?: string): Promise<{
            id: string;
            broken?: string;
        }>;
    };
    agentDefaultModel?: {
        currentSelection(): {
            provider?: string;
            model?: string;
        };
    };
    permissionPresets?: PermissionPresetHost;
};
/**
 * 建会话前探测预设可用性：预设不存在（如插件禁用后残留的登记）或已损坏时回退
 * standard，保证会话头记录的预设与实际挂载一致。宿主没有 resolve 时原样返回，
 * 交给 setup 里的 mount 回退兜底；无预设记录（旧数据）保持 undefined 沿用账号默认。
 */
export declare function usablePresetId(ctx: AgentHost, preset: string | undefined): Promise<string | undefined>;
export declare class SessionRouter {
    private readonly ctx;
    private readonly store;
    private readonly config;
    private readonly log;
    private readonly resolveConfig;
    private readonly live;
    private readonly historical;
    private readonly reloadDisposed;
    private readonly channelOperations;
    private readonly disposeTimeoutMs;
    private readonly onDeliveryStopped?;
    constructor(ctx: AgentHost, store: SessionMapStore, config: EngineConfig, log: (line: string) => void, resolveConfig?: (channelId: string) => EngineConfig, options?: {
        disposeTimeoutMs?: number;
        onDeliveryStopped?: (binding: ChatBinding) => void;
    });
    get(channelId: ChannelInstanceId, kind: ChatKind, chatId: string): ChatBinding | undefined;
    lookup(channelId: ChannelInstanceId, kind: ChatKind, chatId: string): ChatBinding | undefined;
    bindingForSession(sessionId: string): ChatBinding | undefined;
    sessionIdsForChannel(channelId: ChannelInstanceId): string[];
    /** 某个聊天登记过的全部会话记录（含当前绑定），按最近更新排序。 */
    chatRecords(channelId: ChannelInstanceId, kind: ChatKind, chatId: string): SessionRecord[];
    /** 持久化解除投递关系，保留历史及句柄，供网页查看与渠道卸载。 */
    unbindSession(channelId: ChannelInstanceId, kind: ChatKind, chatId: string, sessionId: string): boolean;
    /** 切换绑定后清理：解除本聊天对除 keepSessionId 外全部会话的登记。返回被解除的会话 ID。 */
    unbindOthersForChat(channelId: ChannelInstanceId, kind: ChatKind, chatId: string, keepSessionId?: string): string[];
    /** 静音/取消静音：保留登记但不（或恢复）向聊天投递该会话的输出事件。 */
    setMuted(sessionId: string, muted: boolean): boolean;
    isMuted(sessionId: string): boolean;
    getOrCreate(channelId: ChannelInstanceId, kind: ChatKind, chatId: string, title: string): Promise<ChatBinding>;
    private getOrCreateNow;
    rotate(channelId: ChannelInstanceId, kind: ChatKind, chatId: string, title: string, options?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<ChatBinding>;
    private rotateNow;
    private sessionWorkspace;
    rename(sessionId: string, title: string): boolean;
    isAdopted(sessionId: string): boolean;
    /** 只返回是否占用，不向列表暴露其他聊天身份。 */
    isBoundElsewhere(sessionId: string, channelId: string, kind: ChatKind, chatId: string): boolean;
    /** 显式换绑保留旧历史与运行句柄，不改变 Host 会话的归属或默认配置。 */
    bind(channelId: string, kind: ChatKind, chatId: string, sessionId: string, title: string, agent: unknown, cwd?: string, signal?: AbortSignal): Promise<void>;
    setTitle(sessionId: string, title: string, source: 'message' | 'host' | 'user'): boolean;
    pruneMissingSessions(): Promise<number>;
    private knownSessionIds;
    ensure(sessionId: string): Promise<boolean>;
    disposeAll(): Promise<void>;
    /** 卸载不代表删除日志；只有可靠确认日志不存在才清除索引。 */
    onHostDisposed(sessionId: string): Promise<boolean>;
    /**
     * 投递一条普通用户消息。`steer` 模式在宿主 Agent 提供 next-step 注入时作为补充指令
     * 立即进入运行中的任务；旧宿主没有 `steer` 时保持排队投递，消息不丢失、语义可预期。
     */
    followup(binding: ChatBinding, message: unknown, mode?: SendMode): void;
    disposeChannel(channelId: string): Promise<void>;
    resetChannelSessions(channelId: string): Promise<void>;
    private disposeChannelNow;
    private disposeHandle;
    private removeFromChannel;
    remove(sessionId: string): Promise<boolean>;
    /** 归档失败后，仅在可靠确认日志缺失时清理残留索引。 */
    cleanupMissing(sessionId: string): Promise<boolean>;
    private samePath;
    private create;
    private resume;
    private createHandle;
    attachMappedSessions(active?: () => boolean): Promise<void>;
    private syncStoredTitle;
    private recoverHistory;
    private isArchived;
    private attachWorkspace;
    private resolveAgentOptions;
    private presetSetup;
}
export {};
//# sourceMappingURL=router.d.ts.map