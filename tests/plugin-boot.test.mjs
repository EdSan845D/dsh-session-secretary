import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply, Config, inject, name } from '../lib/index.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, timeoutMs = 3000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时')
    await sleep(10)
  }
}

/**
 * 走真实的 cordis 插件机制（ctx.plugin）而不是直接调 apply：只有这样才能复现
 * 「未 inject 的服务用属性读取」被 cordis 判错、整个插件停在 FAILED 的启动故障。
 * 场景：userQuestions 在场但未进 inject —— 插件必须照常完成启动。
 */
test('插件在真实 cordis 插件机制下完成启动并注册路由', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-secretary-boot-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ctx = new Context()
  const routes = []
  const noop = async () => undefined
  ctx.provide('webServer', {
    register(route) {
      routes.push(`${route.kind} ${route.path}`)
      return () => undefined
    },
  })
  ctx.provide('credentials', { get: noop, set: noop, delete: noop })
  ctx.provide('agents', { create: async () => ({ dispose: async () => undefined }) })
  ctx.provide('agentPresets', { list: async () => [], remoteExportList: async () => ({ presets: [] }) })
  ctx.provide('agentDefaultModel', { provider: 'p', model: 'm' })
  ctx.provide('llm', {})
  ctx.provide('permissionPresets', { defaultPreset: 'standard' })
  // 上游分段回复把 systemPrompt 加进了 inject（注册分段说明 section 用），
  // 测试宿主必须提供最小实现，否则 fiber 永远等依赖、启动停在半路。
  ctx.provide('systemPrompt', { getSectionOrder: () => 10200, section: () => () => undefined })
  // 未进 inject 的可选兼容服务：宿主是在自己的 fiber 里提供的，
  // 消费方用 ctx.userQuestions 直接读会被 cordis 判错（插件因此停在 FAILED）。
  ctx.plugin({
    name: 'host-user-questions',
    apply(hostCtx) {
      hostCtx.provide('userQuestions', { answer: () => true })
    },
  })

  let failure
  const plugin = {
    name,
    inject,
    Config,
    apply(pluginCtx, config) {
      try {
        return apply(pluginCtx, config)
      } catch (error) {
        failure = error
        throw error
      }
    },
  }
  const fiber = ctx.plugin(plugin, Config({ stateDir: dir, cwd: dir }))
  await fiber

  const logFile = join(dir, 'gateway.log')
  await waitFor(() => failure !== undefined || (() => {
    try {
      return readFileSync(logFile, 'utf8').includes('[boot] apply 完成')
    } catch {
      return false
    }
  })())
  assert.equal(failure, undefined, `启动抛出异常：${String(failure)}`)
  assert.ok(routes.some((route) => route.startsWith('prefix ')), `未注册 API 路由：${routes.join(', ')}`)
  await fiber.dispose()
})

/** 缺席时同样不能拖垮启动：代答桥走降级路径。 */
test('userQuestions 缺席时插件仍能完成启动', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-secretary-boot-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ctx = new Context()
  const noop = async () => undefined
  ctx.provide('webServer', { register: () => () => undefined })
  ctx.provide('credentials', { get: noop, set: noop, delete: noop })
  ctx.provide('agents', { create: async () => ({ dispose: async () => undefined }) })
  ctx.provide('agentPresets', { list: async () => [], remoteExportList: async () => ({ presets: [] }) })
  ctx.provide('agentDefaultModel', { provider: 'p', model: 'm' })
  ctx.provide('llm', {})
  ctx.provide('permissionPresets', { defaultPreset: 'standard' })
  ctx.provide('systemPrompt', { getSectionOrder: () => 10200, section: () => () => undefined })

  const fiber = ctx.plugin({ name, inject, Config, apply }, Config({ stateDir: dir, cwd: dir }))
  await fiber
  const logFile = join(dir, 'gateway.log')
  await waitFor(() => {
    try {
      return readFileSync(logFile, 'utf8').includes('[boot] apply 完成')
    } catch {
      return false
    }
  })
  await fiber.dispose()
})
