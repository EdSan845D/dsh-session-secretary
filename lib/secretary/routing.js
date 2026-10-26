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
import { normalizeReplyText, parseMultiQuestionReply, stripReplyTag } from './reply-text.js';
import { parseApprovalDecision } from './approval-text.js';
/**
 * 宿主把「已作答的提问」再次注入时打的标记。
 *
 * 这类消息是**我们自己回答的结果回显**，不是新的用户回复 —— 若不排除，
 * 秘书会把它当作下一条回复继续认领，形成自激循环。
 */
const STEER_MARKER = 'answer_to_pending_question';
/** 生成一个 4 位十六进制标签（随机数源可注入，便于单测）。 */
export function newTag(random = Math.random) {
    return (Math.floor(random() * 0x10000) & 0xffff).toString(16).padStart(4, '0');
}
/** 拼接一条入站消息里的全部文本块。 */
export function messageText(message) {
    const content = message?.content;
    if (!Array.isArray(content))
        return '';
    return content
        .filter((part) => typeof part === 'object' && part !== null)
        .filter(part => part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text ?? '')
        .join('\n');
}
/** 不带标签时的严格匹配：每题都必须是「选中了选项」或「无选项题的自由文本」。 */
function strictQuestionMatch(body, pending) {
    const answers = parseMultiQuestionReply(body, pending.questions);
    if (answers === null)
        return false;
    return answers.every((item, index) => {
        if (item.selected.length > 0)
            return true;
        const custom = (item.custom ?? '').trim();
        if (custom === '')
            return false;
        const question = pending.questions[index];
        return !Array.isArray(question?.options) || question.options.length === 0;
    });
}
/**
 * 判定一条 IM 回复认领了哪个待办（没有则返回 null）。
 *
 * @param questions - 当前待答提问（tag → 题目）。
 * @param approvals - 当前待裁决审批（tag → 占位）。
 */
export function routeReply(input) {
    const raw = typeof input.text === 'string' ? input.text : '';
    if (raw.includes(STEER_MARKER))
        return null;
    const { tag, body } = stripReplyTag(normalizeReplyText(raw));
    if (body === '')
        return null;
    if (tag !== null) {
        const question = input.questions.get(tag);
        if (question !== undefined) {
            const answer = parseMultiQuestionReply(body, question.questions);
            return answer === null ? null : { kind: 'question', tag, answer };
        }
        if (input.approvals.has(tag)) {
            const decision = parseApprovalDecision(body);
            return decision === null ? null : { kind: 'approval', tag, decision };
        }
        return null;
    }
    const matches = [];
    for (const [pendingTag, pending] of input.questions) {
        if (!strictQuestionMatch(body, { tag: pendingTag, questions: pending.questions }))
            continue;
        const answer = parseMultiQuestionReply(body, pending.questions);
        if (answer !== null)
            matches.push({ kind: 'question', tag: pendingTag, answer });
    }
    const decision = parseApprovalDecision(body);
    if (decision !== null) {
        for (const pendingTag of input.approvals.keys()) {
            matches.push({ kind: 'approval', tag: pendingTag, decision });
        }
    }
    return matches.length === 1 ? (matches[0] ?? null) : null;
}
//# sourceMappingURL=routing.js.map