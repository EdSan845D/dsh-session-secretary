/**
 * AI 意图解析（无绑定聊天纯文本 → 动作建议）。
 *
 * 纯逻辑层：提示词构建 + 回复解析。会话机制（一次性无头代理的创建/提问/收听）
 * 由 index.ts 装配注入；本模块只保证「提示词可复现、解析可测试」。
 *
 * 解析产物为结构化动作：open（绑定候选会话）/ create（项目内新建）/ chat
 * （就是想聊天，放回原生流程）/ clarify（置信不足，由装配层列候选确认）。
 */

export interface IntentCandidate {
  sessionId: string
  title: string
  project: string
}

export interface IntentContext {
  userText: string
  chatId: string
  candidates: IntentCandidate[]
}

export interface IntentResult {
  action: 'open' | 'create' | 'chat' | 'clarify'
  sessionId?: string
  project?: string
  confidence: number
  /** 给用户的确认/说明文本（open/create 时装配层据此发确认）。 */
  reply: string
}

/** 候选清单的展示文本（同时是提示词的一部分与确认回复的底稿）。 */
export function candidateLines(candidates: IntentCandidate[]): string[] {
  return candidates.map((item, index) => `${index + 1}. 【${item.project}·${item.title}】 ${item.sessionId}`)
}

export function buildIntentPrompt(ctx: IntentContext): string {
  const lines = candidateLines(ctx.candidates)
  return [
    '你是 DSH 会话调度助手。判断用户想在哪个项目/会话里处理下面这条消息。',
    '只输出一个 JSON 对象，不要输出其他内容，格式：',
    '{"action":"open|create|chat","sessionId":"候选中的会话ID或留空","project":"项目名或留空","confidence":0到1,"reply":"给用户的确认或说明（中文，一句话）"}',
    '规则：',
    '- 用户消息明确指向某个候选会话/项目 → action=open，sessionId 填该候选 id；想新建 → action=create，project 填项目名。',
    '- 用户只是想正常聊天（不针对任何项目/会话）→ action=chat。',
    '- 无法判断 → action=clarify，confidence 低，reply 里给出你的追问。',
    ctx.candidates.length > 0 ? `候选会话：\n${lines.join('\n')}` : '当前没有候选会话。',
    `用户消息：${ctx.userText}`,
  ].join('\n')
}

/** 从模型回复里抠第一个 JSON 对象（容忍 ```json 围栏与前后闲话）。 */
function extractJson(raw: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  const source = fenced !== null ? fenced[1]! : raw
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(source.slice(start, end + 1)) as unknown
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

const ACTIONS = new Set(['open', 'create', 'chat', 'clarify'])

export function parseIntentReply(raw: string, candidates: IntentCandidate[]): IntentResult | null {
  const parsed = extractJson(raw)
  if (parsed === null) return null
  const action = typeof parsed.action === 'string' && ACTIONS.has(parsed.action)
    ? parsed.action as IntentResult['action']
    : null
  if (action === null) return null
  const confidence = typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1
    ? parsed.confidence
    : 0.5
  const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined
  const project = typeof parsed.project === 'string' ? parsed.project : undefined
  const reply = typeof parsed.reply === 'string' && parsed.reply.trim() !== '' ? parsed.reply.trim() : ''
  if (action === 'open') {
    const known = candidates.find(item => item.sessionId === sessionId)
    if (known === undefined) return { action: 'clarify', confidence, reply: reply !== '' ? reply : '没能确定目标会话。' }
    return { action: 'open', sessionId: known.sessionId, project: known.project, confidence, reply }
  }
  if (action === 'create') {
    return { action: 'create', project, confidence, reply }
  }
  return { action, confidence, reply }
}
