/**
 * 审批转发渲染与裁决词解析（纯函数）。
 *
 * 裁决词表与 dsh-im 的 `harness-approval` **逐字一致**：
 * 批准/同意/yes → `allowed-once`，拒绝/不同意/no → `rejected`（去空白、忽略大小写）。
 * 保持一致的意义：用户换用 dsh-im 的会话同步时，肌肉记忆不用改。
 */

import type { ApprovalDecision } from './types.js'

/** 裁决词 → 结论（小写键，查表前统一 lowercase）。 */
const APPROVAL_REPLIES = new Map<string, ApprovalDecision>([
  ['批准', 'allowed-once'],
  ['同意', 'allowed-once'],
  ['yes', 'allowed-once'],
  ['拒绝', 'rejected'],
  ['不同意', 'rejected'],
  ['no', 'rejected'],
])

/** 操作参数摘要上限。 */
const ARGS_MAX = 800
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** 参数仅呈现：`argsSummary` 为空时整段省略（v1 不转发参数）。 */
export interface ApprovalRenderInput {
  toolName?: string
  reason?: string
  argsSummary?: string
}

/** 把一句回复映射为裁决结论；不是裁决词时返回 null。 */
export function parseApprovalDecision(text: string): ApprovalDecision | null {
  return APPROVAL_REPLIES.get(text.trim().toLowerCase()) ?? null
}

/**
 * 渲染一次待审批请求（投递用）。
 *
 * ⚠️ 与提问同理：标签行留在最后且不被截断。
 */
export function renderApproval(
  payload: ApprovalRenderInput,
  tag: string,
  maxChars: number,
  label = '',
): string {
  const toolName = (payload.toolName ?? '').trim() === '' ? '未知工具' : (payload.toolName ?? '').trim()
  const reason = (payload.reason ?? '').trim()
  const rawArgs = (payload.argsSummary ?? '').replace(CONTROL_CHARS, '')
  const summary = rawArgs.length > ARGS_MAX ? `${rawArgs.slice(0, ARGS_MAX)}…` : rawArgs
  const lines = [
    `⚠️会话〈${label === '' ? '未命名' : label}〉等待审批`,
    `工具：${toolName}`,
  ]
  if (reason !== '') lines.push(`原因：${reason}`)
  if (summary !== '') lines.push('操作参数：', summary)
  lines.push('回复「批准」或「拒绝」（也支持：同意 / 不同意 / yes / no）。')
  const tagLine = `[${tag}]`
  const body = lines.join('\n')
  const budget = Math.max(maxChars > 0 ? maxChars : 1200, tagLine.length + 20)
  if (body.length + tagLine.length + 1 <= budget) return `${body}\n${tagLine}`
  return `${body.slice(0, Math.max(budget - tagLine.length - 2, 0))}…\n${tagLine}`
}
