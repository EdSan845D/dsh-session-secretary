/**
 * 提问转发渲染与回复解析（纯函数，无 Node 内置依赖，便于单测）。
 *
 * 回复语义与 dsh-im 的 `harnessAnswerForQuestion` 对齐：序号 → 选项标签、
 * 精确标签命中、多选按分隔符切分、其余文本作为自由输入。这样同一句回复在
 * 「IM 会话同步」与「秘书转发」两条链路上得到相同结果，不会出现两边不一致。
 */
import type { QuestionAnswer, SecretaryQuestion } from './types.js';
/** 全角 ASCII（U+FF01–U+FF5E）折半角，并剔除控制字符后 trim。 */
export declare function normalizeReplyText(text: string): string;
/** 剥掉回复开头的 4-hex 标签；没有标签时 tag 为 null。 */
export declare function stripReplyTag(text: string): {
    tag: string | null;
    body: string;
};
/** 按 dsh-im 语义解析「一问一答」。 */
export declare function parseQuestionReply(text: string, question: SecretaryQuestion | undefined): QuestionAnswer;
/**
 * 解析覆盖多道题的回复：每题一行，题序对应。
 * 行数不足返回 null（宁可不答，也不错位作答）；多出来的行并入最后一题，
 * 避免用户随手加的备注被吞掉。
 */
export declare function parseMultiQuestionReply(text: string, questions: SecretaryQuestion[] | undefined): QuestionAnswer[] | null;
/**
 * 渲染一次待答提问（投递用）。
 *
 * ⚠️ 标签行**必须**留在最后且不被截断：它是回复路由的唯一凭据，
 * 被截掉这条消息就只能靠「严格匹配」兜底，误答风险陡增。
 */
export declare function renderQuestions(questions: SecretaryQuestion[], tag: string, maxChars: number, label?: string): string;
//# sourceMappingURL=reply-text.d.ts.map