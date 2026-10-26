import assert from 'node:assert/strict'
import test from 'node:test'
import { buildIntentPrompt, parseIntentReply, candidateLines } from '../../lib/secretary/intent.js'

const CANDIDATES = [
  { sessionId: 's-aaa', title: '修 bug', project: 'proj1' },
  { sessionId: 's-bbb', title: '写文档', project: 'proj2' },
]

test('buildIntentPrompt includes rules, candidates, and the user text', () => {
  const prompt = buildIntentPrompt({ userText: '看看proj1的日志', chatId: 'u1', candidates: CANDIDATES })
  assert.match(prompt, /只输出一个 JSON 对象/)
  assert.match(prompt, /【proj1·修 bug】 s-aaa/)
  assert.match(prompt, /用户消息：看看proj1的日志/)
})

test('candidateLines numbers each candidate', () => {
  assert.deepEqual(candidateLines(CANDIDATES), ['1. 【proj1·修 bug】 s-aaa', '2. 【proj2·写文档】 s-bbb'])
})

test('parseIntentReply accepts open with a known sessionId (code fence tolerated)', () => {
  const raw = '```json\n{"action":"open","sessionId":"s-aaa","confidence":0.9,"reply":"要打开 proj1 的会话吗？"}\n```'
  const result = parseIntentReply(raw, CANDIDATES)
  assert.deepEqual(result, { action: 'open', sessionId: 's-aaa', project: 'proj1', confidence: 0.9, reply: '要打开 proj1 的会话吗？' })
})

test('parseIntentReply: open with unknown sessionId degrades to clarify', () => {
  const result = parseIntentReply('{"action":"open","sessionId":"nope"}', CANDIDATES)
  assert.equal(result?.action, 'clarify')
})

test('parseIntentReply: create keeps project; chat passes through', () => {
  const create = parseIntentReply('{"action":"create","project":"proj3","confidence":0.8,"reply":"新建？"}', CANDIDATES)
  assert.equal(create?.action, 'create')
  assert.equal(create?.project, 'proj3')
  const chat = parseIntentReply('{"action":"chat"}', CANDIDATES)
  assert.equal(chat?.action, 'chat')
})

test('parseIntentReply returns null for non-JSON or unknown action', () => {
  assert.equal(parseIntentReply('好的，我明白了', CANDIDATES), null)
  assert.equal(parseIntentReply('{"action":"destroy"}', CANDIDATES), null)
  assert.equal(parseIntentReply('{"action":"open"', CANDIDATES), null)
})
