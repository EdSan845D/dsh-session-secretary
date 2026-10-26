import { describe, expect, it } from 'vitest'
import {
  normalizeReplyText,
  parseMultiQuestionReply,
  parseQuestionReply,
  renderQuestions,
  stripReplyTag,
} from '../../src/secretary/reply-text.ts'
import type { SecretaryQuestion } from '../../src/secretary/types.ts'

const TAG = 'a3f2'

function option(label: string, description?: string): { label: string; description?: string } {
  return description === undefined ? { label } : { label, description }
}

const Q_MODE: SecretaryQuestion = {
  id: 'mode',
  question: '选择运行模式？',
  options: [option('快速', '跳过检查'), option('完整', '全部检查')],
}
const Q_FREE: SecretaryQuestion = { id: 'name', question: '项目叫什么？' }

describe('renderQuestions', () => {
  it('单选题：编号选项 + 提示 + 标签留在最后', () => {
    const text = renderQuestions([Q_MODE], TAG, 1200, 'demo')
    expect(text).toMatch(/❓会话〈demo〉需要你回答/)
    expect(text).toMatch(/选择运行模式？/)
    expect(text).toMatch(/1\. 快速 — 跳过检查/)
    expect(text).toMatch(/2\. 完整/)
    expect(text).toMatch(/选项序号或文字/)
    expect(text.trimEnd().endsWith(`[${TAG}]`)).toBe(true)
  })

  it('细节照常呈现，超长细节被截断', () => {
    const withDetail: SecretaryQuestion = { id: 'plan', question: '计划可行？', detail: '第一步：先做 A。' }
    expect(renderQuestions([withDetail], TAG, 4000, '')).toMatch(/第一步：先做 A。/)
    const huge: SecretaryQuestion = { id: 'plan', question: '计划可行？', detail: '长'.repeat(1200) }
    const rendered = renderQuestions([huge], TAG, 4000, '')
    expect(rendered).toMatch(/…/)
    expect(rendered.length).toBeLessThan(1400)
  })

  it('多选题补一行逗号提示', () => {
    expect(renderQuestions([{ ...Q_MODE, multiSelect: true }], TAG, 1200, '')).toMatch(/逗号/)
  })

  it('多题：题号与逐行提示', () => {
    const text = renderQuestions([Q_MODE, Q_FREE], TAG, 4000, '')
    expect(text).toMatch(/共 2 题/)
    expect(text).toMatch(/第 1 题/)
    expect(text).toMatch(/第 2 题/)
  })

  it('超长整体截断后标签仍然存活（标签是回复路由的唯一凭据）', () => {
    const long: SecretaryQuestion = { id: 'x', question: '啊'.repeat(3000) }
    const text = renderQuestions([long], TAG, 300, '')
    expect(text.length).toBeLessThanOrEqual(320)
    expect(text.trimEnd().endsWith(`[${TAG}]`)).toBe(true)
  })
})

describe('stripReplyTag', () => {
  it('识别带括号 / 裸标签 / 冒号分隔三种写法', () => {
    expect(stripReplyTag('[a3f2] 2')).toEqual({ tag: 'a3f2', body: '2' })
    expect(stripReplyTag('a3f2：2')).toEqual({ tag: 'a3f2', body: '2' })
    expect(stripReplyTag('a3f2 2')).toEqual({ tag: 'a3f2', body: '2' })
    expect(stripReplyTag('[a3f2]')).toEqual({ tag: 'a3f2', body: '' })
  })

  it('非 4 位十六进制前缀不当作标签', () => {
    expect(stripReplyTag('[zzzz] 1')).toEqual({ tag: null, body: '[zzzz] 1' })
    expect(stripReplyTag('12 1')).toEqual({ tag: null, body: '12 1' })
  })
})

describe('normalizeReplyText', () => {
  it('全角折半角并剔除控制字符', () => {
    expect(normalizeReplyText('　１２ ab　')).toBe('12 ab')
    expect(normalizeReplyText('ＹＥＳ')).toBe('YES')
    expect(normalizeReplyText('ab')).toBe('ab')
  })
})

describe('parseQuestionReply', () => {
  it('序号与精确标签都映射到选项，其余作自由输入', () => {
    expect(parseQuestionReply('2', Q_MODE)).toEqual({ id: 'mode', selected: ['完整'] })
    expect(parseQuestionReply('完整', Q_MODE)).toEqual({ id: 'mode', selected: ['完整'] })
    expect(parseQuestionReply('都不行，用保守方案', Q_MODE)).toEqual({
      id: 'mode',
      selected: [],
      custom: '都不行，用保守方案',
    })
  })

  it('无选项题整段作为自由输入', () => {
    expect(parseQuestionReply('秘书', Q_FREE)).toEqual({ id: 'name', selected: [], custom: '秘书' })
  })

  it('多选按分隔符切分，未命中部分并回自由输入', () => {
    const multi: SecretaryQuestion = { ...Q_MODE, multiSelect: true }
    expect(parseQuestionReply('快速，完整', multi)).toEqual({ id: 'mode', selected: ['快速', '完整'] })
    expect(parseQuestionReply('1、3', multi)).toEqual({ id: 'mode', selected: ['快速'], custom: '3' })
  })

  it('自由输入不做长度截断（用户写多少就传多少）', () => {
    const long = '长'.repeat(2000)
    expect(parseQuestionReply(long, Q_MODE).custom).toBe(long)
  })
})

describe('parseMultiQuestionReply', () => {
  it('逐行对应题目顺序', () => {
    expect(parseMultiQuestionReply('2\n秘书', [Q_MODE, Q_FREE])).toEqual([
      { id: 'mode', selected: ['完整'] },
      { id: 'name', selected: [], custom: '秘书' },
    ])
  })

  it('行数不足返回 null（宁可不答也不错位）', () => {
    expect(parseMultiQuestionReply('2', [Q_MODE, Q_FREE])).toBeNull()
  })

  it('多余的行并入最后一题，备注不丢', () => {
    const answers = parseMultiQuestionReply('1\n秘书\n（简称即可）', [Q_MODE, Q_FREE])
    expect(answers?.[1]).toEqual({ id: 'name', selected: [], custom: '秘书\n（简称即可）' })
  })
})
