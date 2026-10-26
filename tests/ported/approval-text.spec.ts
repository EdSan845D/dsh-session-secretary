import { describe, expect, it } from 'vitest'
import { parseApprovalDecision, renderApproval } from '../../src/secretary/approval-text.ts'

const TAG = 'b7c1'

describe('parseApprovalDecision', () => {
  it('批准类词 → allowed-once', () => {
    expect(parseApprovalDecision('批准')).toBe('allowed-once')
    expect(parseApprovalDecision('同意')).toBe('allowed-once')
    expect(parseApprovalDecision('YES')).toBe('allowed-once')
    expect(parseApprovalDecision('  yes  ')).toBe('allowed-once')
  })

  it('拒绝类词 → rejected', () => {
    expect(parseApprovalDecision('拒绝')).toBe('rejected')
    expect(parseApprovalDecision('不同意')).toBe('rejected')
    expect(parseApprovalDecision('No')).toBe('rejected')
  })

  it('其它文本不是裁决词（不当作审批回复）', () => {
    expect(parseApprovalDecision('批准吧')).toBeNull()
    expect(parseApprovalDecision('再等等')).toBeNull()
    expect(parseApprovalDecision('')).toBeNull()
  })
})

describe('renderApproval', () => {
  it('工具名与原因入正文，标签留在最后', () => {
    const text = renderApproval({ toolName: 'bash', reason: '需要提权' }, TAG, 1200, 'demo')
    expect(text).toMatch(/⚠️会话〈demo〉等待审批/)
    expect(text).toMatch(/工具：bash/)
    expect(text).toMatch(/原因：需要提权/)
    expect(text.trimEnd().endsWith(`[${TAG}]`)).toBe(true)
  })

  it('工具名缺失回落为「未知工具」', () => {
    expect(renderApproval({}, TAG, 1200, '')).toMatch(/工具：未知工具/)
  })

  it('参数摘要为空时整段省略（v1 不转发参数）', () => {
    const text = renderApproval({ toolName: 'bash', argsSummary: '' }, TAG, 1200, '')
    expect(text).not.toMatch(/操作参数/)
  })

  it('超长参数被截断且标签存活', () => {
    const text = renderApproval({ toolName: 'bash', argsSummary: '长'.repeat(2000) }, TAG, 400, '')
    expect(text).toMatch(/…/)
    expect(text.length).toBeLessThanOrEqual(420)
    expect(text.trimEnd().endsWith(`[${TAG}]`)).toBe(true)
  })
})
