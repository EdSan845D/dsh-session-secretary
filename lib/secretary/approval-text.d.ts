/**
 * 审批转发渲染与裁决词解析（纯函数）。
 *
 * 裁决词表与 dsh-im 的 `harness-approval` **逐字一致**：
 * 批准/同意/yes → `allowed-once`，拒绝/不同意/no → `rejected`（去空白、忽略大小写）。
 * 保持一致的意义：用户换用 dsh-im 的会话同步时，肌肉记忆不用改。
 */
import type { ApprovalDecision } from './types.js';
/** 参数仅呈现：`argsSummary` 为空时整段省略（v1 不转发参数）。 */
export interface ApprovalRenderInput {
    toolName?: string;
    reason?: string;
    argsSummary?: string;
}
/** 把一句回复映射为裁决结论；不是裁决词时返回 null。 */
export declare function parseApprovalDecision(text: string): ApprovalDecision | null;
/**
 * 渲染一次待审批请求（投递用）。
 *
 * ⚠️ 与提问同理：标签行留在最后且不被截断。
 */
export declare function renderApproval(payload: ApprovalRenderInput, tag: string, maxChars: number, label?: string): string;
//# sourceMappingURL=approval-text.d.ts.map