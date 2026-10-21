import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockAgent, ProxyAgent } from 'undici'
import { ChannelManager } from '../lib/manager.js'
import { createSlackChannel } from '../lib/channels/slack.js'

function makeManager(t, stateDir = mkdtempSync(join(tmpdir(), 'im-connect-slack-proxy-'))) {
  const manager = new ChannelManager({
    ctx: { permissionPresets: { names: ['review'], defaultPreset: 'review', optionOf: value => ({ value, name: value }) } },
    stateDir,
    log: () => undefined,
    engineConfig: { cwd: stateDir, provider: 'test', model: 'test', agentPreset: 'standard', mergeTimeoutSecs: 5, permissionPreset: 'review' },
  })
  manager.startOne = async () => undefined
  t.after(() => { manager.disposeApi(); rmSync(stateDir, { recursive: true, force: true }) })
  return manager
}

async function createSlackAccount(manager) {
  return manager.connect('slack', { token: 'xoxb-test', appToken: 'xapp-test' }, {
    provider: 'test', model: 'test', cwd: tmpdir(), permission: 'review', privateAccess: 'approved',
  })
}

test('Slack 代理地址可在账号设置快照中反显，且存放在凭据库', async t => {
  const stateDir = mkdtempSync(join(tmpdir(), 'im-connect-slack-proxy-'))
  const manager = makeManager(t, stateDir)
  const created = await createSlackAccount(manager)
  assert.equal(created.ok, true)

  const proxyUrlInput = 'http://127.0.0.1:7897'
  const proxyUrl = `${proxyUrlInput}/`
  const saved = await manager.updateAccount(created.accountId, {
    proxyMode: 'custom',
    proxyUrl: proxyUrlInput,
  })

  assert.equal(saved.ok, true)
  assert.equal(saved.account.proxyMode, 'custom')
  assert.equal(saved.account.proxyConfigured, true)
  assert.equal(saved.account.proxyUrl, proxyUrl)

  const listed = manager.list().flatMap(channel => channel.accounts).find(item => item.id === created.accountId)
  assert.equal(listed.proxyUrl, proxyUrl)
  const persisted = JSON.parse(readFileSync(manager.file, 'utf8'))
  assert.equal(JSON.stringify(persisted).includes(proxyUrl), false)

  const restarted = makeManager(t, stateDir)
  await restarted.initEnabled()
  const restored = restarted.list().flatMap(channel => channel.accounts).find(item => item.id === created.accountId)
  assert.equal(restored.proxyUrl, proxyUrl)
})

test('Slack 代理配置未变时不重复重启通道，真正变更或切回 inherit 时才重启', async t => {
  const manager = makeManager(t)
  const created = await createSlackAccount(manager)
  assert.equal(created.ok, true)

  const proxyUrl = 'http://127.0.0.1:7897/'
  const first = await manager.updateAccount(created.accountId, {
    proxyMode: 'custom',
    proxyUrl: 'http://127.0.0.1:7897',
  })
  assert.equal(first.ok, true)
  assert.equal(first.account.proxyUrl, proxyUrl)

  // 模拟通道正在运行
  manager.running.set(created.accountId, { stop: async () => {}, status: () => '长连接已建立' })

  let restartCount = 0
  manager.startOne = async () => { restartCount++ }

  // 1. 仅改备注且带相同 proxyUrl：不应重启
  const remarkSave = await manager.updateAccount(created.accountId, {
    name: '新备注名称',
    proxyMode: 'custom',
    proxyUrl: 'http://127.0.0.1:7897',
  })
  assert.equal(remarkSave.ok, true)
  assert.equal(restartCount, 0, '代理未变化时不应重启通道')

  // 2. 留空代理地址保存：保持现有代理，不应重启
  const emptyUrlSave = await manager.updateAccount(created.accountId, {
    proxyMode: 'custom',
  })
  assert.equal(emptyUrlSave.ok, true)
  assert.equal(emptyUrlSave.account.proxyUrl, proxyUrl)
  assert.equal(restartCount, 0, '留空保存现有代理时不应重启通道')

  // 3. 修改代理地址为新端口：应触发 1 次重启
  const changedUrlSave = await manager.updateAccount(created.accountId, {
    proxyMode: 'custom',
    proxyUrl: 'http://127.0.0.1:7898',
  })
  assert.equal(changedUrlSave.ok, true)
  assert.equal(changedUrlSave.account.proxyUrl, 'http://127.0.0.1:7898/')
  assert.equal(restartCount, 1, '代理地址真正变更时应重启通道')

  // 4. 从 custom 切回 inherit：应清理凭据、回显并重启通道
  const inheritSave = await manager.updateAccount(created.accountId, {
    proxyMode: 'inherit',
  })
  assert.equal(inheritSave.ok, true)
  assert.equal(inheritSave.account.proxyMode, 'inherit')
  assert.equal(inheritSave.account.proxyConfigured, false)
  assert.equal(inheritSave.account.proxyUrl, undefined)
  assert.equal(restartCount, 2, '切回 inherit 时应重启通道')

  const listed = manager.list().flatMap(c => c.accounts).find(a => a.id === created.accountId)
  assert.equal(listed.proxyUrl, undefined)
  assert.equal(listed.proxyConfigured, false)
})

test('Slack Web API、Socket Mode 与诊断使用代理并在 stop 时释放 dispatcher', async t => {
  t.after(() => mock.restoreAll())
  const capturedFetches = []
  mock.method(globalThis, 'fetch', async (url, init = {}) => {
    capturedFetches.push({ url: String(url), init })
    if (String(url).endsWith('/auth.test')) return Response.json({ ok: true, user_id: 'U1', team: 'T1' })
    if (String(url).endsWith('/apps.connections.open')) return Response.json({ ok: true, url: 'wss://wss-primary.slack.com/link' })
    return Response.json({ ok: true })
  })

  let createdSocketOptions = null
  class MockWebSocket {
    constructor(url, options) {
      createdSocketOptions = options
    }
    addEventListener(type, cb) {
      if (type === 'message') setTimeout(() => cb({ data: JSON.stringify({ type: 'hello' }) }), 5)
    }
    send() {}
    close() {}
  }
  mock.method(globalThis, 'WebSocket', MockWebSocket)

  const channel = createSlackChannel({
    token: 'xoxb-test',
    appToken: 'xapp-test',
    proxyMode: 'custom',
    proxyUrl: 'http://127.0.0.1:7897',
    connectTimeoutMs: 200,
  }, () => {})
  assert.ok(channel)

  // 诊断走代理 fetch
  const diagnostics = await channel.diagnose(new AbortController().signal)
  const botCheck = diagnostics.find(item => item.id === 'bot')
  assert.equal(botCheck?.status, 'passed')
  assert.ok(capturedFetches[0].init.dispatcher instanceof ProxyAgent)

  await channel.start()
  assert.ok(createdSocketOptions?.dispatcher instanceof ProxyAgent)

  await channel.stop()
})

test('Slack 代理配置仅显示在该渠道设置页，不出现在新增账号凭据表单', () => {
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const meta = readFileSync(new URL('../src/channels/meta.ts', import.meta.url), 'utf8')
  const bind = client.slice(client.indexOf('function BindModal'), client.indexOf('function AccountSettingsPicker'))
  const inspector = client.slice(client.indexOf('function AccountInspector'), client.indexOf('function AccountRemarkEditor'))
  assert.match(inspector, /account\.platform === "telegram" \|\| account\.platform === "slack"/)
  assert.doesNotMatch(bind, /proxyMode|proxyUrl/)
  assert.match(meta, /slack:[\s\S]*proxyUrl/)
})
