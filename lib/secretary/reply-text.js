/**
 * 提问转发渲染与回复解析（纯函数，无 Node 内置依赖，便于单测）。
 *
 * 回复语义与 dsh-im 的 `harnessAnswerForQuestion` 对齐：序号 → 选项标签、
 * 精确标签命中、多选按分隔符切分、其余文本作为自由输入。这样同一句回复在
 * 「IM 会话同步」与「秘书转发」两条链路上得到相同结果，不会出现两边不一致。
 */
/** 多选回复的分隔符（中英文逗号/顿号/分号/换行）。 */
const SEPARATOR_SPLIT = /[,，、;；\n]+/;
/** 控制字符（IM 消息里偶发，直接剔除，避免污染选项比对）。 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/** 行首 4 位十六进制标签，形如 `[a3f2]` 或 `a3f2 `。 */
const TAG_PREFIX = /^\[?([0-9a-f]{4})\]?(?:[\s:：]+|$)/;
/** IM 细节文本的单题上限（防刷屏）。 */
const DETAIL_MAX = 600;
/** 全角 ASCII（U+FF01–U+FF5E）折半角，并剔除控制字符后 trim。 */
export function normalizeReplyText(text) {
    let out = '';
    for (const char of text) {
        const code = char.codePointAt(0);
        out += code !== undefined && code >= 0xff01 && code <= 0xff5e
            ? String.fromCharCode(code - 0xfee0)
            : char;
    }
    return out.replace(CONTROL_CHARS, '').trim();
}
/** 剥掉回复开头的 4-hex 标签；没有标签时 tag 为 null。 */
export function stripReplyTag(text) {
    const match = TAG_PREFIX.exec(text);
    if (match === null)
        return { tag: null, body: text };
    const tag = match[1];
    return { tag: tag ?? null, body: text.slice(match[0].length).trim() };
}
/** 单个 token → 选项标签（序号或精确标签），命中不了返回 null。 */
function optionLabelOf(token, options) {
    const normalized = token.trim();
    if (normalized === '')
        return null;
    if (/^\d+$/.test(normalized)) {
        const option = options[Number(normalized) - 1];
        return typeof option?.label === 'string' ? option.label : null;
    }
    const exact = options.find(option => option?.label === normalized);
    return typeof exact?.label === 'string' ? exact.label : null;
}
/** 按 dsh-im 语义解析「一问一答」。 */
export function parseQuestionReply(text, question) {
    const options = Array.isArray(question?.options) ? question.options : [];
    const id = question?.id;
    if (options.length === 0) {
        // 无选项：整段都是自由输入。
        return { ...(id === undefined ? {} : { id }), selected: [], custom: text };
    }
    const wholeLabel = optionLabelOf(text, options);
    if (question?.multiSelect !== true) {
        return wholeLabel !== null
            ? { ...(id === undefined ? {} : { id }), selected: [wholeLabel] }
            : { ...(id === undefined ? {} : { id }), selected: [], custom: text };
    }
    if (wholeLabel !== null) {
        return { ...(id === undefined ? {} : { id }), selected: [wholeLabel] };
    }
    const selected = [];
    const custom = [];
    for (const token of text.split(SEPARATOR_SPLIT)) {
        const value = token.trim();
        if (value === '')
            continue;
        const label = optionLabelOf(value, options);
        if (label !== null) {
            if (!selected.includes(label))
                selected.push(label);
        }
        else {
            custom.push(value);
        }
    }
    return {
        ...(id === undefined ? {} : { id }),
        selected,
        ...(custom.length > 0 ? { custom: custom.join('、') } : {}),
    };
}
/**
 * 解析覆盖多道题的回复：每题一行，题序对应。
 * 行数不足返回 null（宁可不答，也不错位作答）；多出来的行并入最后一题，
 * 避免用户随手加的备注被吞掉。
 */
export function parseMultiQuestionReply(text, questions) {
    if (!Array.isArray(questions) || questions.length === 0)
        return null;
    const first = questions[0];
    if (questions.length === 1)
        return [parseQuestionReply(text, first)];
    const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '');
    if (lines.length < questions.length)
        return null;
    const extra = lines.slice(questions.length - 1).join('\n');
    return questions.map((question, index) => parseQuestionReply(index === questions.length - 1 ? extra : (lines[index] ?? ''), question));
}
/** 单题文本块（含题号、题干、细节、选项、多选提示）。 */
function questionBlock(question, index, total) {
    const lines = [];
    if (total > 1)
        lines.push(`— 第 ${index + 1} 题 —`);
    if (typeof question.header === 'string' && question.header.trim() !== '') {
        lines.push(question.header.trim());
    }
    lines.push(typeof question.question === 'string' && question.question.trim() !== ''
        ? question.question.trim()
        : '请输入你的回答。');
    if (typeof question.detail === 'string' && question.detail.trim() !== '') {
        const detail = question.detail.trim();
        lines.push(detail.length > DETAIL_MAX ? `${detail.slice(0, DETAIL_MAX)}…` : detail);
    }
    const options = Array.isArray(question.options) ? question.options : [];
    options.forEach((option, optionIndex) => {
        const label = typeof option?.label === 'string' ? option.label : '';
        const description = typeof option?.description === 'string' && option.description.trim() !== ''
            ? option.description.trim()
            : '';
        lines.push(`${optionIndex + 1}. ${label}${description === '' ? '' : ` — ${description}`}`);
    });
    if (question.multiSelect === true)
        lines.push('（本题为多选：多个选项用逗号分隔）');
    return lines.join('\n');
}
/**
 * 渲染一次待答提问（投递用）。
 *
 * ⚠️ 标签行**必须**留在最后且不被截断：它是回复路由的唯一凭据，
 * 被截掉这条消息就只能靠「严格匹配」兜底，误答风险陡增。
 */
export function renderQuestions(questions, tag, maxChars, label = '') {
    const list = Array.isArray(questions) ? questions : [];
    const head = `❓会话〈${label === '' ? '未命名' : label}〉需要你回答`;
    const intro = list.length > 1 ? `${head}（共 ${list.length} 题，请逐行回复）` : head;
    const hint = list.length > 1
        ? '回复格式：每题一行，按题目顺序作答。'
        : '回复一个选项序号或文字即可作答。';
    const tagLine = `[${tag}]`;
    const body = [
        intro,
        ...list.map((question, index) => questionBlock(question, index, list.length)),
        hint,
    ].join('\n');
    const budget = Math.max(maxChars > 0 ? maxChars : 1200, tagLine.length + 20);
    if (body.length + tagLine.length + 1 <= budget)
        return `${body}\n${tagLine}`;
    return `${body.slice(0, Math.max(budget - tagLine.length - 2, 0))}…\n${tagLine}`;
}
//# sourceMappingURL=reply-text.js.map