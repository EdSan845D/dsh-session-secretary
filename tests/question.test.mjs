import assert from 'node:assert/strict'
import test from 'node:test'
import {
  QuestionBroker,
  answerUserQuestion,
  formatUserQuestion,
  validUserQuestion,
} from '../lib/engine/question.js'

test('问题格式包含进度、说明、选项和群聊提示', () => {
  const text = formatUserQuestion({
    id: 'environment',
    header: '运行环境',
    question: '请选择环境',
    detail: '生产环境会执行真实操作。',
    options: [
      { label: '测试', description: '仅验证' },
      { label: '生产' },
    ],
  }, 0, 2, { requiresMention: true })
  assert.match(text, /（1\/2）/)
  assert.match(text, /1\. 测试 — 仅验证/)
  assert.match(text, /2\. 生产/)
  assert.match(text, /@机器人/)
})

test('多选勾选状态写入唯一选项列表，单选不展示勾选状态', () => {
  const base = { id: 'q', question: '请选择', options: [{ label: '甲', description: '说明' }, { label: '乙' }] }
  const selected = new Set([0, 99])
  const multi = formatUserQuestion({ ...base, multiSelect: true }, 0, 1, { selected })
  assert.match(multi, /1\. ✓ 甲 — 说明/)
  assert.match(multi, /2\. 乙/)
  assert.equal(multi.split('甲').length - 1, 1)
  assert.doesNotMatch(formatUserQuestion(base, 0, 1, { selected }), /✓/)
})

test('单选、多选和自定义回答保持 DSH 结构', () => {
  const single = { id: 'env', question: '环境', options: [{ label: '测试' }, { label: '生产' }] }
  assert.deepEqual(answerUserQuestion(single, '2'), { id: 'env', selected: ['生产'] })
  assert.deepEqual(answerUserQuestion(single, '本地'), { id: 'env', selected: [], custom: '本地' })

  const multi = { ...single, id: 'items', multiSelect: true }
  assert.deepEqual(answerUserQuestion(multi, '1，生产，自定义'), {
    id: 'items',
    selected: ['测试', '生产'],
    custom: '自定义',
  })
})

test('问题校验拒绝错误字段', () => {
  assert.equal(validUserQuestion({ id: 'ok', question: '回答', options: [{ label: 'A' }] }), true)
  assert.equal(validUserQuestion({ id: 'bad', question: '回答', options: [{ label: 1 }] }), false)
  assert.equal(validUserQuestion({ id: 'bad', question: '回答', multiSelect: 'yes' }), false)
  assert.equal(validUserQuestion({ id: 'bad', question: '回答', intent: { kind: 1 } }), false)
})

test('QuestionBroker 顺序收集并响应取消', async () => {
  const broker = new QuestionBroker()
  const pending = broker.begin('session', [
    { id: 'one', question: '一' },
    { id: 'two', question: '二', options: [{ label: 'A' }] },
  ])
  assert.ok(pending)
  assert.equal(broker.answer('session', '过早回答').waitingPresentation, true)
  assert.equal(broker.activate('session'), true)
  assert.equal(broker.answer('session', '自由回答').next?.question.id, 'two')
  assert.equal(broker.answer('session', '过早回答').waitingPresentation, true)
  assert.equal(broker.activate('session'), true)
  assert.equal(broker.answer('session', '1').completed, true)
  assert.deepEqual(await pending, {
    answers: [
      { id: 'one', selected: [], custom: '自由回答' },
      { id: 'two', selected: ['A'] },
    ],
  })

  const controller = new AbortController()
  const aborted = broker.begin('abort', [{ id: 'x', question: 'x' }], controller.signal)
  controller.abort(new Error('cancelled'))
  await assert.rejects(aborted, /cancelled/)
  broker.dispose()
})
