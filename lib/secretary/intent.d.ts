/**
 * AI 意图解析（无绑定聊天纯文本 → 动作建议）。
 *
 * 纯逻辑层：提示词构建 + 回复解析。会话机制（一次性无头代理的创建/提问/收听）
 * 由 index.ts 装配注入；本模块只保证「提示词可复现、解析可测试」。
 *
 * 解析产物为结构化动作：open（绑定候选会话）/ create（项目内新建）/ chat
 * （就是想聊天，放回原生流程）/ clarify（置信不足，由装配层列候选确认）。
 */
export interface IntentCandidate {
    sessionId: string;
    title: string;
    project: string;
}
export interface IntentContext {
    userText: string;
    chatId: string;
    candidates: IntentCandidate[];
}
export interface IntentResult {
    action: 'open' | 'create' | 'chat' | 'clarify';
    sessionId?: string;
    project?: string;
    confidence: number;
    /** 给用户的确认/说明文本（open/create 时装配层据此发确认）。 */
    reply: string;
}
/** 候选清单的展示文本（同时是提示词的一部分与确认回复的底稿）。 */
export declare function candidateLines(candidates: IntentCandidate[]): string[];
export declare function buildIntentPrompt(ctx: IntentContext): string;
export declare function parseIntentReply(raw: string, candidates: IntentCandidate[]): IntentResult | null;
//# sourceMappingURL=intent.d.ts.map