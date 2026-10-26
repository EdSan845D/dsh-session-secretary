/**
 * dsh-im-connect Host：IM 助理。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { ChannelManager } from './manager.js'
import type { EngineConfig } from './engine/types.js'
import type { TopicMode } from './engine/topic-title.js'
import { createRotatingFileAppender } from './engine/file-log.js'
import { registerPluginUpdater } from './plugin-updater.js'

export const name = 'dsh-session-secretary'
export const inject = [
  'webServer',
  'credentials',
  'agents',
  'agentPresets',
  'agentDefaultModel',
  'llm',
  'permissionPresets',
]

export interface PluginConfig {
  stateDir: string
  cwd: string
  provider: string
  model: string
  agentPreset: string
  mergeTimeoutSecs: number
  topicNaming: TopicMode
  updater?: boolean
  onlineUpdate?: boolean
  // [secretary] 会话秘书行为组
  secretary?: SecretaryConfig
  // [secretary] 系统通知通道（桌面壳默认关：原生弹窗由 client 半边承担）
  system?: SystemConfig
  // [secretary] 浏览器通知通道（client 半边读取）
  browser?: BrowserConfig
}

export interface SecretaryConfig {
  notifyQuestion: boolean
  notifyApproval: boolean
  notifyCompletion: boolean
  notifyError: boolean
  labelPrefix: boolean
  intentParse: boolean
  controlChatId: string
  pendingTtlMinutes: number
  maxForwardChars: number
}

export interface SystemConfig {
  enabled: boolean
  icon?: string
  verbosity: 'minimal' | 'normal' | 'detailed'
}

export interface BrowserConfig {
  enabled: boolean
  onlyWhenHidden: boolean
  verbosity: 'minimal' | 'normal' | 'detailed'
}

const notifyVerbosity = Schema.union(['minimal', 'normal', 'detailed'] as const).default('normal')

export const Config: Schema<PluginConfig> = Schema.object({
  stateDir: Schema.string().default(''),
  cwd: Schema.string().default(process.cwd()),
  provider: Schema.string().default(''),
  model: Schema.string().default(''),
  agentPreset: Schema.string().default('standard'),
  mergeTimeoutSecs: Schema.number().default(5),
  topicNaming: Schema.union(['once', 'follow', 'off']).default('once'),
  updater: Schema.boolean().default(false),
  onlineUpdate: Schema.boolean().default(false),
  // [secretary]
  secretary: Schema.object({
    notifyQuestion: Schema.boolean().default(true),
    notifyApproval: Schema.boolean().default(true),
    notifyCompletion: Schema.boolean().default(true),
    notifyError: Schema.boolean().default(true),
    labelPrefix: Schema.boolean().default(true),
    intentParse: Schema.boolean().default(true),
    controlChatId: Schema.string().default(''),
    pendingTtlMinutes: Schema.number().default(1440),
    maxForwardChars: Schema.number().default(1200),
  }),
  system: Schema.object({
    enabled: Schema.boolean().default(false),
    icon: Schema.string(),
    verbosity: notifyVerbosity,
  }),
  browser: Schema.object({
    enabled: Schema.boolean().default(true),
    onlyWhenHidden: Schema.boolean().default(true),
    verbosity: notifyVerbosity,
  }),
})

export function apply(ctx: Context, config: PluginConfig): void {
  const hostUpdateDisabled = config.updater === false || config.onlineUpdate === false
  const permissionPresets = (ctx as Context & { permissionPresets: { defaultPreset: string } }).permissionPresets
  const stateDir = config.stateDir !== ''
    ? config.stateDir
    : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-session-secretary')
  mkdirSync(stateDir, { recursive: true })
  const logFile = join(stateDir, 'gateway.log')
  const fileLog = createRotatingFileAppender(logFile)
  const log = (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`
    ctx.logger(name).info(line)
    fileLog.append(`${stamped}\n`)
  }

  const engineConfig: EngineConfig = {
    cwd: config.cwd || process.cwd(),
    provider: config.provider,
    model: config.model,
    agentPreset: config.agentPreset || 'standard',
    mergeTimeoutSecs: config.mergeTimeoutSecs || 5,
    permissionPreset: permissionPresets.defaultPreset,
    topicNaming: config.topicNaming ?? 'once',
  }

  const applyStarted = Date.now()
  const manager = new ChannelManager({ ctx, stateDir, log, engineConfig, hostUpdateDisabled })
  log(`[boot] ChannelManager 构造 ${Date.now() - applyStarted}ms`)
  ctx.effect(() => registerPluginUpdater(ctx, {
    endpoint: '/api/michengai/dsh-im-connect/update',
    packageName: '@michengai/dsh-im-connect',
    manifestUrl: new URL('../package.json', import.meta.url),
    isEnabled: async () => !hostUpdateDisabled && manager.isUpdateEnabled(),
  }), 'im-connect.plugin-updater')
  ctx.effect(() => {
    manager.registerApi(ctx)
    // 卸载或初始化失败后不再恢复会话；保留一个完整异常链，避免后台拒绝终止宿主。
    void manager.initEnabled().then(() => manager.attachMappedSessions()).catch(error => {
      fileLog.append(`${new Date().toISOString()} [boot] 初始化失败: ${error instanceof Error ? error.message : String(error)}\n`)
    })
    log(`[boot] apply 完成 ${Date.now() - applyStarted}ms`)
    return () => { manager.disposeApi(); void fileLog.flush() }
  }, 'im-connect.serve')
}

export { CHANNEL_META, CHANNEL_ORDER, listChannelMeta } from './channels/meta.js'
export {
  IM_ORIGIN,
  IM_SESSION_PREFIX,
  createImSessionId,
  isImOrigin,
  isImSessionId,
  isTaskSession,
  sessionKeyOf,
} from './engine/session-id.js'
export { splitText } from './engine/split.js'
