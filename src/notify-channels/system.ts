/**
 * 系统通知通道：OS 级 toast（Windows / macOS / Linux），经 node-notifier 投递。
 *
 * 自 dsh-messager 移植。平台差异与降级策略：
 * - Windows：PowerShell ToastNotification（内建），sound 可靠；
 * - macOS / Linux：terminal-notifier / notify-send 无内建声音参数，不传 sound；
 * - icon 必须是存在的文件路径，无效时整段省略（三平台对非法路径都可能直接失败）；
 * - 发送失败时做一次「去掉图标」的重试，再交由调用方记录。
 */

import { existsSync } from 'node:fs'
import notifier from 'node-notifier'

export interface NotificationPayload {
  title: string
  body: string
}

export interface NotifyChannel {
  id: string
  send(payload: NotificationPayload): Promise<void>
}

export interface SystemChannelOptions {
  /** 图标绝对路径（node-notifier 需要文件路径且该文件必须存在）。 */
  icon?: string
}

type SystemNotifyOptions = {
  title: string
  message?: string
  icon?: string
  wait: false
  sound?: boolean
}

function buildOptions(payload: NotificationPayload, rawIcon: string | undefined): SystemNotifyOptions {
  const icon = rawIcon !== undefined && rawIcon !== '' && existsSync(rawIcon) ? rawIcon : undefined
  const common: Omit<SystemNotifyOptions, 'sound'> = {
    title: payload.title,
    ...(payload.body === '' ? {} : { message: payload.body }),
    ...(icon === undefined ? {} : { icon }),
    wait: false,
  }
  switch (process.platform) {
    case 'win32':
      return { ...common, sound: true }
    case 'darwin':
    case 'linux':
    default:
      return common
  }
}

function deliver(options: SystemNotifyOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    notifier.notify(options, (error) => {
      if (error !== null) reject(error)
      else resolve()
    })
  })
}

export function createSystemChannel(options: SystemChannelOptions = {}): NotifyChannel {
  return {
    id: 'system',
    async send(payload: NotificationPayload): Promise<void> {
      try {
        await deliver(buildOptions(payload, options.icon))
      } catch (error) {
        try {
          await deliver(buildOptions(payload, undefined))
        } catch {
          throw error
        }
      }
    },
  }
}
