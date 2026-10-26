import { describe, expect, it } from 'vitest'
import { messageText, newTag, routeReply } from '../../src/secretary/routing.ts'
import type { SecretaryQuestion } from '../../src/secretary/types.ts'

const option = (label: string) => ({ label })
const Q_TWO: SecretaryQuestion = { id: 'mode', question: '选模式？', options: [option('快速'), option('完整')] }
const Q_FOUR: SecretaryQuestion = {
  id: 'level',
  question: '选等级？',
  options: [option('a'), option('b'), option('c'), option('d')],
}
const Q_FREE: SecretaryQuestion = { id: 'name', question: '项目叫什么？' }

const questions = (...entries: Array<[string, SecretaryQuestion[]]>) =>
  new Map(entries.map(([tag, list]) => [tag, { questions: list }]))
const approvals = (...tags: string[]) => new Map(tags.map(tag => [tag, { tag }]))

describe('newTag', () => {
  it('按注入的随机源产出 4 位十六进制', () => {
    expect(newTag(() => 0)).toBe('0000')
    expect(newTag(() => 0.5)).toBe('8000')
    expect(newTag()).toMatch(/^[0-9a-f]{4}$/)
  })
})

describe('messageText', () => {
  it('拼接文本块、跳过非文本块', () => {
    expect(messageText({
      content: [{ type: 'text', text: '1' }, { type: 'image', url: 'x' }, { type: 'text', text: '2' }],
    })).toBe('1\n2')
    expect(messageText(undefined)).toBe('')
  })
})

describe('routeReply 带标签', () => {
  it('标签命中提问时无条件路由，自由文本也收', () => {
    expect(routeReply({
      text: '[a3f2] 用保守方案',
      questions: questions(['a3f2', [Q_TWO]]),
      approvals: approvals(),
    })).toEqual({
      kind: 'question',
      tag: 'a3f2',
      answer: [{ id: 'mode', selected: [], custom: '用保守方案' }],
    })
  })

  it('标签命中审批', () => {
    expect(routeReply({
      text: 'b7c1 批准',
      questions: questions(),
      approvals: approvals('b7c1'),
    })).toEqual({ kind: 'approval', tag: 'b7c1', decision: 'allowed-once' })
  })

  it('未知标签或空正文不认领', () => {
    expect(routeReply({ text: '[ffff] 1', questions: questions(), approvals: approvals() })).toBeNull()
    expect(routeReply({
      text: '[a3f2]',
      questions: questions(['a3f2', [Q_TWO]]),
      approvals: approvals(),
    })).toBeNull()
  })
})

describe('routeReply 不带标签（严格匹配）', () => {
  it('序号命中唯一待答', () => {
    expect(routeReply({
      text: '2',
      questions: questions(['a3f2', [Q_TWO]]),
      approvals: approvals(),
    })).toEqual({ kind: 'question', tag: 'a3f2', answer: [{ id: 'mode', selected: ['完整'] }] })
  })

  it('闲聊句绝不认领选项题', () => {
    expect(routeReply({
      text: '帮我看看日志',
      questions: questions(['a3f2', [Q_TWO]]),
      approvals: approvals(),
    })).toBeNull()
  })

  it('自由文本只认领无选项题', () => {
    expect(routeReply({
      text: '秘书',
      questions: questions(['a3f2', [Q_FREE]]),
      approvals: approvals(),
    })).toEqual({ kind: 'question', tag: 'a3f2', answer: [{ id: 'name', selected: [], custom: '秘书' }] })
  })

  it('多个待答同时命中 → 不认领（含糊即放弃）', () => {
    expect(routeReply({
      text: '2',
      questions: questions(['a3f2', [Q_TWO]], ['b7c1', [{ ...Q_TWO, id: 'mode2' }]]),
      approvals: approvals(),
    })).toBeNull()
  })

  it('只有唯一一个真正命中时选中它', () => {
    expect(routeReply({
      text: '3',
      questions: questions(['a3f2', [Q_TWO]], ['b7c1', [Q_FOUR]]),
      approvals: approvals(),
    })).toEqual({ kind: 'question', tag: 'b7c1', answer: [{ id: 'level', selected: ['c'] }] })
  })

  it('服务回显的 steer 记录永不被当作回复（否则自激）', () => {
    const steer = JSON.stringify({ kind: 'answer_to_pending_question', callId: 'x' })
    expect(routeReply({
      text: steer,
      questions: questions(['a3f2', [Q_FREE]]),
      approvals: approvals(),
    })).toBeNull()
  })

  it('裁决词认领唯一待审批；两个待审批时不认领', () => {
    expect(routeReply({ text: '同意', questions: questions(), approvals: approvals('b7c1') }))
      .toEqual({ kind: 'approval', tag: 'b7c1', decision: 'allowed-once' })
    expect(routeReply({ text: '拒绝', questions: questions(), approvals: approvals('b7c1', 'c3d9') }))
      .toBeNull()
  })
})
