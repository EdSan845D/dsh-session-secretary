type AssistantContent = ReadonlyArray<{ type?: string; text?: string }>

/**
 * 提取可投递的助手正文；启用过滤时，含工具调用的整条消息返回 undefined。
 * undefined 表示主动抑制，不是投递成功；空串表示消息本身没有文字。
 */
export function assistantText(content: AssistantContent = [], skipInterimText = false): string | undefined {
  if (skipInterimText && content.some(block => block.type === 'tool-call')) return undefined
  return content.filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text ?? '').join('\n').trim()
}
