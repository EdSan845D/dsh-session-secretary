// 会话秘书 Agent 预设：命令目录唯一事实来源、人设内容、预设定义、注册生命周期与降级。
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply, Config, inject, name } from '../lib/index.js'
import { ChannelManager } from '../lib/manager.js'
import { chatCommandSections, chatControlHelp } from '../lib/engine/chat-commands.js'
import {
  SECRETARY_PRESET_ID,
  SECRETARY_PRESET_NAME,
  buildSecretaryPersona,
  secretaryPresetDefinition,
} from '../lib/secretary/preset.js'
import { SessionRouter, usablePresetId } from '../lib/engine/router.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(check, timeoutMs = 3000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时')
    await sleep(10)
  }
}

function logLines(dir) {
  try { return readFileSync(join(dir, 'gateway.log'), 'utf8') } catch { return '' }
}

test('默认 agentPreset 是插件注册的秘书预设', () => {
  const config = Config({ stateDir: '.', cwd: '.' })
  assert.equal(config.agentPreset, SECRETARY_PRESET_ID)
  assert.equal(SECRETARY_PRESET_ID, 'session-secretary')
})

test('命令目录是 /help 的唯一事实来源（无漂移）', () => {
  const help = chatControlHelp()
  let cursor = help.indexOf('**入口**')
  assert.ok(cursor > 0, '/help 缺少入口小节')
  for (const section of chatCommandSections) {
    const heading = help.indexOf(section.heading, cursor)
    assert.ok(heading >= 0, `/help 缺少小节 ${section.heading}`)
    cursor = heading
    for (const command of section.commands) {
      const at = help.indexOf(command, cursor)
      assert.ok(at >= 0, `/help 缺少命令行：${command}`)
      cursor = at
    }
  }
})

test('秘书人设以秘书身份回答「你有哪些指令」，命令清单与 /help 同源', () => {
  const persona = buildSecretaryPersona()
  assert.ok(persona.includes('会话秘书'), '人设缺少身份定位')
  for (const keyword of ['通知', '审批', 'IM 控制台', '你有哪些指令']) {
    assert.ok(persona.includes(keyword), `人设缺少关键词：${keyword}`)
  }
  assert.ok(persona.includes('不要回答通用 DSH 指令'), '人设未约定不回答通用 DSH 指令')
  for (const section of chatCommandSections) {
    assert.ok(persona.includes(section.heading), `人设缺少小节 ${section.heading}`)
    for (const command of section.commands) {
      assert.ok(persona.includes(`- ${command}`), `人设缺少命令行：${command}`)
    }
  }
  assert.ok(!persona.includes('You are a coding agent'), '人设不应保留编码助手开场白')
})

test('预设定义：persona 行替换为秘书人设，其余镜像 standard 组成', () => {
  const definition = secretaryPresetDefinition()
  assert.equal(definition.id, 'session-secretary')
  assert.equal(definition.name, SECRETARY_PRESET_NAME)
  assert.equal(typeof definition.description, 'string')
  assert.equal(definition.order, 2)
  const rows = definition.plugins
  assert.equal(rows[0].id, 'persona', 'persona 必须是首行')
  assert.equal(rows[0].name, '@deepseek-ai/dsh-persona')
  assert.ok(rows[0].config.prefix.startsWith('你是「会话秘书」'), 'persona 行未使用秘书人设')
  const ids = rows.map((row) => row.id)
  for (const required of ['agent-instructions', 'time-context', 'tool-fs', 'tool-fs-search', 'tool-jobs', 'tool-schedule', 'skill-filesystem', 'tool-skill', 'command-goal', 'tool-goal', 'tool-ask-user', 'tool-todo', 'tool-web', 'present']) {
    assert.ok(ids.includes(required), `缺少 standard 行：${required}`)
  }
  // 平台条件由 !!js 改为注册时求值的布尔：恰好一个 shell 工具启用。
  const bash = rows.find((row) => row.id === 'tool-bash')
  const pwsh = rows.find((row) => row.id === 'tool-pwsh')
  assert.equal(typeof bash.disabled, 'boolean')
  assert.equal(typeof pwsh.disabled, 'boolean')
  assert.notEqual(bash.disabled, pwsh.disabled)
  const groupOf = (id) => rows.find((row) => row.id === id)
  assert.deepEqual(groupOf('planning').isolate, { planMode: true })
  assert.deepEqual(groupOf('compaction').isolate, { compaction: true, toolResultPruner: true })
  assert.deepEqual(groupOf('delegation').isolate, { workflowEngine: true })
  assert.equal(groupOf('tool-plugin-manager').disabled, true)
  assert.equal(groupOf('tool-plugin-market').disabled, true)
})

/** 与 tests/plugin-boot.test.mjs 同款的最小宿主；agentPresets 由用例注入。 */
async function bootWith(agentPresets) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-secretary-preset-'))
  const ctx = new Context()
  const noop = async () => undefined
  ctx.provide('webServer', { register: () => () => undefined })
  ctx.provide('credentials', { get: noop, set: noop, delete: noop })
  ctx.provide('agents', { create: async () => ({ dispose: async () => undefined }) })
  ctx.provide('agentDefaultModel', { provider: 'p', model: 'm' })
  ctx.provide('llm', {})
  ctx.provide('permissionPresets', { defaultPreset: 'standard' })
  ctx.provide('systemPrompt', { getSectionOrder: () => 10200, section: () => () => undefined })
  ctx.provide('agentPresets', agentPresets)
  const fiber = ctx.plugin({ name, inject, Config, apply }, Config({ stateDir: dir, cwd: dir }))
  await fiber
  return { ctx, fiber, dir }
}

test('宿主支持 register 时注册秘书预设，插件注销时一并移除', async () => {
  const registered = []
  let unregistered = 0
  const { fiber, dir } = await bootWith({
    list: async () => [],
    remoteExportList: async () => ({ presets: [] }),
    async register(definition) {
      registered.push(definition)
      return async () => { unregistered += 1 }
    },
  })
  try {
    await waitFor(() => registered.length === 1)
    assert.equal(registered[0].id, 'session-secretary')
    assert.equal(registered[0].name, '会话秘书')
    assert.ok(Array.isArray(registered[0].plugins) && registered[0].plugins.length > 10)
    assert.ok(!logLines(dir).includes('[secretary-preset]'), '注册成功不应写降级日志')
  } finally {
    await fiber.dispose()
  }
  await waitFor(() => unregistered === 1)
})

test('宿主缺 register 时降级：不注册、日志说明、IM 会话回退 standard', async () => {
  const { fiber, dir } = await bootWith({ list: async () => [], remoteExportList: async () => ({ presets: [] }) })
  try {
    await waitFor(() => logLines(dir).includes('agentPresets 服务不支持 register'))
  } finally {
    await fiber.dispose()
  }
  assert.ok(logLines(dir).includes('IM 新会话沿用 standard'))
})

test('register 抛错（如预设 id 冲突）时同样降级且插件照常激活', async () => {
  const { fiber, dir } = await bootWith({
    list: async () => [],
    remoteExportList: async () => ({ presets: [] }),
    async register() { throw new Error('Duplicate agent preset: session-secretary') },
  })
  try {
    await waitFor(() => logLines(dir).includes('注册失败: Duplicate agent preset'))
  } finally {
    await fiber.dispose()
  }
})

test('usablePresetId：损坏或缺失的预设回退 standard，正常预设原样返回', async () => {
  assert.equal(await usablePresetId({}, 'session-secretary'), 'session-secretary', '旧宿主无 resolve 时原样返回')
  assert.equal(await usablePresetId({}, undefined), undefined)
  assert.equal(await usablePresetId({}, 'standard'), 'standard')
  const ctx = (resolve) => ({ agentPresets: { resolve } })
  assert.equal(await usablePresetId(ctx(async () => ({ id: 'session-secretary' })), 'session-secretary'), 'session-secretary')
  assert.equal(await usablePresetId(ctx(async () => ({ id: 'session-secretary', broken: 'import failed' })), 'session-secretary'), 'standard')
  assert.equal(await usablePresetId(ctx(async () => { throw new Error('Unknown agent preset') }), 'session-secretary'), 'standard')
})

test('setup 挂载失败时回退 standard，standard 自身失败仍向上抛', async () => {
  const mounted = []
  const makeRouter = async (mount) => new SessionRouter(
    { agentPresets: { mount } },
    { get: () => undefined },
    { agentPreset: 'standard', cwd: '.', provider: '', model: '', mergeTimeoutSecs: 5, permissionPreset: 'standard' },
    () => {},
    () => ({ agentPreset: 'session-secretary', cwd: '.', provider: '', model: '', mergeTimeoutSecs: 5, permissionPreset: 'standard' }),
  )
  const fallback = await makeRouter(async (_agentCtx, preset) => {
    mounted.push(preset)
    if (preset !== 'standard') throw new Error('agent-preset/not-found')
  })
  await fallback.presetSetup('channel')({}, undefined)
  assert.deepEqual(mounted, ['session-secretary', 'standard'])

  mounted.length = 0
  const strict = await makeRouter(async (_agentCtx, preset) => {
    mounted.push(preset)
    throw new Error('preset is broken')
  })
  await assert.rejects(() => strict.presetSetup('channel')({}, undefined), /preset is broken/)
  assert.deepEqual(mounted, ['session-secretary', 'standard'])
})

/** 构造带指定 channels.json 的 manager（fixture 与 workspace-required.test.mjs 同款最小宿主）。 */
function bootManager(t, stateDir, agentPreset) {
  return new ChannelManager({
    ctx: {
      permissionPresets: { names: ['review'], defaultPreset: 'review', optionOf: (n) => ({ value: n, name: n }) },
      get(n) { return n === 'workspaceRegistry' ? { list: () => [{ path: 'D:/proj' }] } : undefined },
    },
    stateDir,
    log: () => undefined,
    engineConfig: {
      cwd: 'D:/proj', provider: 'p', model: 'm', agentPreset, mergeTimeoutSecs: 5, permissionPreset: 'review',
    },
  })
}

function legacyStore(presetMigrated) {
  return {
    version: 2,
    channels: {
      telegram_old: {
        id: 'telegram_old', platform: 'telegram', name: 'tg', agentPreset: 'standard',
        assistant: { provider: 'p', model: 'm' }, cwd: 'D:/proj', permission: 'review', config: {},
      },
    },
    allowlist: {}, pending: {},
    ...(presetMigrated === undefined ? {} : { presetMigrated }),
  }
}

test('默认预设切到秘书后，旧账号固化的 standard 释放为跟随默认（仅一次）', (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), 'dsh-secretary-migrate-'))
  t.after(() => rmSync(stateDir, { recursive: true, force: true }))
  writeFileSync(join(stateDir, 'channels.json'), JSON.stringify(legacyStore()))
  const manager = bootManager(t, stateDir, 'session-secretary')
  manager.disposeApi()
  assert.equal('agentPreset' in manager.store.channels.telegram_old, false)
  const persisted = JSON.parse(readFileSync(join(stateDir, 'channels.json'), 'utf8'))
  assert.equal(persisted.presetMigrated, true)

  // 标记已落：用户显式选回 standard 的账号不再被迁移触碰。
  writeFileSync(join(stateDir, 'channels.json'), JSON.stringify(legacyStore(true)))
  const manager2 = bootManager(t, stateDir, 'session-secretary')
  manager2.disposeApi()
  assert.equal(manager2.store.channels.telegram_old.agentPreset, 'standard')
})

test('默认预设不是秘书预设（降级或显式固定）时不迁移、不落标记', (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), 'dsh-secretary-migrate-'))
  t.after(() => rmSync(stateDir, { recursive: true, force: true }))
  writeFileSync(join(stateDir, 'channels.json'), JSON.stringify(legacyStore()))
  const manager = bootManager(t, stateDir, 'standard')
  manager.disposeApi()
  assert.equal(manager.store.channels.telegram_old.agentPreset, 'standard')
  const persisted = JSON.parse(readFileSync(join(stateDir, 'channels.json'), 'utf8'))
  assert.notEqual(persisted.presetMigrated, true)
})
