import type { Choice } from './choices.js';
import type { ChannelAdapter, ImMessage } from './types.js';
import type { SessionRouter } from './router.js';
export interface CommandHost {
    get(name: string): unknown;
}
export declare const chatControlHelp: () => string;
export declare class ChatCommands {
    private readonly host;
    private readonly router;
    private readonly pending;
    private readonly onSession;
    private readonly showChoices?;
    private readonly onRenamed?;
    private readonly onTopicName?;
    private readonly lifetime;
    private readonly choices;
    private readonly reasoningChoices;
    constructor(host: CommandHost, router: SessionRouter, pending: (sessionId: string) => boolean, onSession?: (sessionId: string, msg: ImMessage) => void, showChoices?: ((channel: ChannelAdapter, msg: ImMessage, text: string, choices: Choice[], session?: string, allowNumber?: boolean) => Promise<string>) | undefined, onRenamed?: ((sessionId: string, title: string) => void) | undefined, onTopicName?: ((channel: ChannelAdapter, msg: ImMessage, action?: "on" | "off") => string) | undefined);
    clear(): void;
    private service;
    private call;
    private presets;
    private permissionLabel;
    private agent;
    private snapshot;
    private workspaces;
    private listSessions;
    /** 工作区目录基名（项目名）。 */
    private static pathBase;
    /** 名称匹配：精确（大小写不敏感）优先，唯一前缀次之；多个 → many（列候选），0 → none。 */
    private matchByName;
    private sessionTitleOf;
    private workspaceNameOf;
    /** 候选列表回复：序号已 remember，用户回 `/session N`（或 `/workspace N`）即可命中。 */
    private candidatesReply;
    /**
     * [secretary] `/session` 名字形态：
     * - 两段：`/session <项目基名> [会话标题]`——项目唯一命中 → 项目内标题精确/前缀唯一 → 绑定；
     *   会话 miss → 在该项目新建（对齐「进入已有会话或创建会话」）；
     * - 一段：先全量会话标题，再项目基名；项目命中时取其第一个空闲会话，无可接入会话则新建；
     * - 都不命中且单 token 恰为完整会话 ID → 返回 null 落回原生路径。
     */
    private sessionByName;
    /** [secretary] 绑定指定会话到聊天：归档/归属/运行中/忙闲校验 + router.bind，返回回复文案。 */
    private switchToSession;
    private remember;
    private reasoningChoice;
    private resolve;
    private idle;
    execute(channel: ChannelAdapter, msg: ImMessage, signal: AbortSignal): Promise<string>;
    /** 附加查询限时且独立降级，不能把已完成操作改报失败。 */
    private optional;
    private newDetails;
    private run;
}
//# sourceMappingURL=chat-commands.d.ts.map