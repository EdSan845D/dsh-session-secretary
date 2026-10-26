/**
 * 回复 → 待办交互的路由（纯函数）。
 *
 * 认领规则（设计文档 §5.4）：
 * - **带标签**（回复里的 4-hex `[a3f2]`）→ 无条件路由到该待办，内容按自由文本解析
 *   （带标签就是「用户在明确回答这条」，不该再被严格匹配拦下）；
 * - **不带标签** → 只有在**恰好一个**待办严格命中时才认领：选项题认选项标签或
 *   在范围内的序号，无选项题才认自由文本，审批只认裁决词。含糊则一律不认领。
 *
 * 为什么这么保守：IM 里同时存在正常聊天（尤其机器人也在群里被 @），
 * 宁可漏掉一次回复让用户重发带标签的版本，也不能把闲聊当成答案喂给模型。
 */
import type { ApprovalDecision, InboxClaimed, QuestionAnswer, SecretaryQuestion } from './types.js';
/** 待办提问（路由只需要 tag 与题目）。 */
export interface PendingQuestionView {
    tag: string;
    questions: SecretaryQuestion[];
}
/** 路由结果：认领到提问或审批。 */
export type RoutedReply = {
    kind: 'question';
    tag: string;
    answer: QuestionAnswer[];
} | {
    kind: 'approval';
    tag: string;
    decision: ApprovalDecision;
};
/** 生成一个 4 位十六进制标签（随机数源可注入，便于单测）。 */
export declare function newTag(random?: () => number): string;
/** 拼接一条入站消息里的全部文本块。 */
export declare function messageText(message: InboxClaimed['message']): string;
/**
 * 判定一条 IM 回复认领了哪个待办（没有则返回 null）。
 *
 * @param questions - 当前待答提问（tag → 题目）。
 * @param approvals - 当前待裁决审批（tag → 占位）。
 */
export declare function routeReply(input: {
    text: string;
    questions: Map<string, {
        questions: SecretaryQuestion[];
    }>;
    approvals: Map<string, unknown>;
}): RoutedReply | null;
//# sourceMappingURL=routing.d.ts.map