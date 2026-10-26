/**
 * 生命周期通知：完成 / 出错（以及中断转发的投递出口）。
 *
 * - 控制聊天：正文前缀【项目·会话】（labelOf 失败退回无前缀原文，绝不丢通知）；
 * - 系统通道：title + 同一正文（桌面壳下默认关闭，node-notifier 兜底无头部署）；
 * - 任一路径失败只告警，不抛出到事件监听器。
 */

import type { SecretaryDispatch } from './bridge.js'

export interface NotificationChannel {
  send(chatId: string, text: string): Promise<void>
}

export interface ControlTarget {
  channel: NotificationChannel
  chatId: string
}

export interface SystemLike {
  send(payload: { title: string; body: string }): Promise<void>
}

export interface NotifierLogger {
  warn(message: string): void
}

export interface NotifierDeps {
  /** 控制聊天目标（未学习/渠道未连接时为 null）。 */
  control(): ControlTarget | null
  /** 系统通知通道（system.enabled=false 时为 undefined）。 */
  system?: SystemLike
  labelOf(sessionId: string): Promise<string>
  logger: NotifierLogger
}

export function createNotifier(deps: NotifierDeps) {
  async function sendControl(text: string): Promise<void> {
    const target = deps.control()
    if (target === null) return
    try {
      await target.channel.send(target.chatId, text)
    } catch (error) {
      deps.logger.warn(`secretary: 控制聊天投递失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    /** 桥的转发（提问/审批正文自带「会话〈label〉」与 tag），只落控制聊天。 */
    async dispatchForward(signal: SecretaryDispatch): Promise<void> {
      await sendControl(signal.body)
    },

    /** 生命周期通知：完成/出错，双通道。 */
    async lifecycle(sessionId: string, title: string, body: string): Promise<void> {
      const label = await deps.labelOf(sessionId).catch(() => '')
      const text = label === '' ? body : `${label}${body}`
      await sendControl(text)
      if (deps.system !== undefined) {
        try {
          await deps.system.send({ title, body: text })
        } catch (error) {
          deps.logger.warn(`secretary: 系统通知失败: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    },
  }
}

export type Notifier = ReturnType<typeof createNotifier>
