/**
 * 分段回复：把一条助手回复按标记切成多条 IM 消息。
 *
 * 和 `split.ts` 的区别：那里按平台字符上限被动切长文，这里按模型主动写下的
 * 分隔标记切「一条一句话」的短消息。标记必须独占一行，围栏代码块里的同名
 * 标记不算分隔符，避免代码示例把回复拆散。
 */
import { replyText } from './command-locale.js';
export const DEFAULT_SEGMENT_MARKER = '<<<MSG>>>';
/** 分段之间的默认随机间隔区间（秒）。 */
export const DEFAULT_SEGMENT_DELAY_MIN_SECS = 1;
export const DEFAULT_SEGMENT_DELAY_MAX_SECS = 2;
/**
 * 在区间内随机取一个发送间隔（毫秒）。
 *
 * 上下界都包含：`[min, max]` 内按整秒取随机值，避免两条消息挨得太近
 * 被平台合并或限流。`random` 可注入，测试据此断言边界。
 */
export function randomSegmentDelay(minMs, maxMs, random = Math.random) {
    const min = Math.max(0, Math.round(minMs));
    const max = Math.max(min, Math.round(maxMs));
    if (max === min)
        return min;
    // 区间够宽时按整秒取值，间隔读起来更像真人；窄区间退回毫秒。
    const step = max - min >= 1000 ? 1000 : 1;
    const steps = Math.floor((max - min) / step) + 1;
    const draw = random();
    const offset = Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 0.999999) : 0;
    return min + Math.floor(offset * steps) * step;
}
const FENCE_MARKER = /^\s{0,3}(`{3,}|~{3,})/;
function fenceOf(line) {
    return FENCE_MARKER.exec(line)?.[1];
}
/** 结束标记：与开始标记同字符，且不短于开始标记，行内不能有其他内容。 */
function closesFence(line, marker) {
    const found = fenceOf(line);
    return found !== undefined && found[0] === marker[0] && found.length >= marker.length && line.trim() === found;
}
/**
 * 按分段标记切分正文。
 *
 * 正文里没有标记、或标记全在代码块里时返回原文一条，调用方据此走原有单条投递。
 */
export function splitSegments(text, marker) {
    const target = marker.trim();
    const normalized = (text ?? '').replace(/\r\n?/g, '\n').trim();
    if (!normalized)
        return [];
    if (!target)
        return [normalized];
    const parts = [[]];
    let fence;
    for (const line of normalized.split('\n')) {
        if (fence) {
            if (closesFence(line, fence))
                fence = undefined;
            parts[parts.length - 1].push(line);
            continue;
        }
        const opening = fenceOf(line);
        if (opening) {
            fence = opening;
            parts[parts.length - 1].push(line);
            continue;
        }
        if (line.trim() === target) {
            parts.push([]);
            continue;
        }
        parts[parts.length - 1].push(line);
    }
    const segments = parts.map(part => part.join('\n').trim()).filter(part => part.length > 0);
    return segments.length > 0 ? segments : [normalized];
}
/** 打开分段回复时附在系统提示里的说明；标记可配置，提示词跟着标记走。 */
export function segmentInstruction(marker) {
    return replyText('IM 分段回复已开启：请把这次回复拆成几条短消息，每条之间单独一行写 {0}。通常 2 到 4 条，一条讲一件事；代码块、表格和链接里不要写分隔行。', marker);
}
//# sourceMappingURL=segments.js.map