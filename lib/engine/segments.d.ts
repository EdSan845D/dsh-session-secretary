export declare const DEFAULT_SEGMENT_MARKER = "<<<MSG>>>";
/** 分段之间的默认随机间隔区间（秒）。 */
export declare const DEFAULT_SEGMENT_DELAY_MIN_SECS = 1;
export declare const DEFAULT_SEGMENT_DELAY_MAX_SECS = 2;
/**
 * 在区间内随机取一个发送间隔（毫秒）。
 *
 * 上下界都包含：`[min, max]` 内按整秒取随机值，避免两条消息挨得太近
 * 被平台合并或限流。`random` 可注入，测试据此断言边界。
 */
export declare function randomSegmentDelay(minMs: number, maxMs: number, random?: () => number): number;
/**
 * 按分段标记切分正文。
 *
 * 正文里没有标记、或标记全在代码块里时返回原文一条，调用方据此走原有单条投递。
 */
export declare function splitSegments(text: string, marker: string): string[];
/** 打开分段回复时附在系统提示里的说明；标记可配置，提示词跟着标记走。 */
export declare function segmentInstruction(marker: string): string;
//# sourceMappingURL=segments.d.ts.map