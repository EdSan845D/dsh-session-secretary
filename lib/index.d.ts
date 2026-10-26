/**
 * dsh-im-connect Host：IM 助理。
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { TopicMode } from './engine/topic-title.js';
export declare const name = "dsh-session-secretary";
export declare const inject: string[];
export interface PluginConfig {
    stateDir: string;
    cwd: string;
    provider: string;
    model: string;
    agentPreset: string;
    mergeTimeoutSecs: number;
    topicNaming: TopicMode;
    updater?: boolean;
    onlineUpdate?: boolean;
    secretary?: SecretaryConfig;
    system?: SystemConfig;
    browser?: BrowserConfig;
}
export interface SecretaryConfig {
    notifyQuestion: boolean;
    notifyApproval: boolean;
    notifyCompletion: boolean;
    notifyError: boolean;
    labelPrefix: boolean;
    intentParse: boolean;
    controlChatId: string;
    pendingTtlMinutes: number;
    maxForwardChars: number;
}
export interface SystemConfig {
    enabled: boolean;
    icon?: string;
    verbosity: 'minimal' | 'normal' | 'detailed';
}
export interface BrowserConfig {
    enabled: boolean;
    onlyWhenHidden: boolean;
    verbosity: 'minimal' | 'normal' | 'detailed';
}
export declare const Config: Schema<PluginConfig>;
export declare function apply(ctx: Context, config: PluginConfig): void;
export { CHANNEL_META, CHANNEL_ORDER, listChannelMeta } from './channels/meta.js';
export { IM_ORIGIN, IM_SESSION_PREFIX, createImSessionId, isImOrigin, isImSessionId, isTaskSession, sessionKeyOf, } from './engine/session-id.js';
export { splitText } from './engine/split.js';
//# sourceMappingURL=index.d.ts.map