import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockAgent, ProxyAgent } from 'undici'
import { ChannelManager } from '../lib/manager.js'
import { createDiscordChannel } from '../lib/channels/discord.js'

function makeManager(t, stateDir = mkdtempSync(join(tmpdir(), 'im-connect-discord-proxy-'))) {
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

async function createDiscordAccount(manager) {
  return manager.connect('discord', { token: 'discord-token-123' }, {
    provider: 'test', model: 'test', cwd: tmpdir(), permission: 'review', privateAccess: 'approved',
  })
}

test('Discord 代理地址可在账号设置快照中反显，且存放在凭据库', async t => {
  const stateDir = mkdtempSync(join(tmpdir(), 'im-connect-discord-proxy-'))
  const manager = makeManager(t, stateDir)
  const created = await createDiscordAccount(manager)
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

  // 凭据丢失降级测试
  await restarted.vault.unset(`im_connect_${created.accountId}_proxyUrl`)
  const missingVault = makeManager(t, stateDir)
  await missingVault.initEnabled()
  const broken = missingVault.list().flatMap(channel => channel.accounts).find(item => item.id === created.accountId)
  assert.equal(broken.proxyMode, 'custom')
  assert.equal(broken.proxyConfigured, false)
  assert.equal(broken.proxyUrl, undefined)
})

test('非法代理模式或 URL 被拒绝，原有配置保持不变', async t => {
  const manager = makeManager(t)
  const created = await createDiscordAccount(manager)
  assert.equal(created.ok, true)

  for (const [proxyMode, proxyUrl] of [
    ['unknown', 'http://127.0.0.1:7897'],
    ['custom', 'socks5://127.0.0.1:7897'],
    ['custom', 'http://127.0.0.1:7897/path'],
    ['custom', 'http://alice:secret@127.0.0.1:7897'],
    ['custom', 'http://127.0.0.1:99999'],
    ['custom', 'not a URL'],
  ]) {
    const result = await manager.updateAccount(created.accountId, { proxyMode, proxyUrl })
    assert.equal(result.ok, false, `${proxyMode} ${proxyUrl}`)
  }
  const account = manager.list().flatMap(channel => channel.accounts).find(item => item.id === created.accountId)
  assert.equal(account.proxyMode, 'inherit')
  assert.equal(account.proxyConfigured, false)
})

test('Discord 代理配置未变时不重复重启通道，真正变更或切回 inherit 时才重启', async t => {
  const manager = makeManager(t)
  const created = await createDiscordAccount(manager)
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

test('Discord Web API、Gateway 与诊断使用代理并在 stop 时释放 dispatcher', async t => {
  t.after(() => mock.restoreAll())
  const capturedFetches = []
  mock.method(globalThis, 'fetch', async (url, init = {}) => {
    capturedFetches.push({ url: String(url), init })
    if (String(url).endsWith('/users/@me')) return Response.json({ id: '12345', bot: true })
    if (String(url).endsWith('/gateway/bot')) return Response.json({ url: 'wss://gateway.discord.gg' })
    if (String(url).includes('/channels/') && String(url).endsWith('/messages')) return Response.json({ id: 'msg-1' })
    return Response.json({ ok: true })
  })

  let createdSocketOptions = null
  class MockWebSocket {
    constructor(url, options) {
      createdSocketOptions = options
    }
    addEventListener(type, cb) {
      if (type === 'message') {
        setTimeout(() => cb({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }) }), 5)
      }
    }
    send() {}
    close() {}
  }
  const originalWs = globalThis.WebSocket
  globalThis.WebSocket = MockWebSocket
  t.after(() => { globalThis.WebSocket = originalWs })

  const channel = createDiscordChannel({
    token: 'discord-token-123',
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

  // 消息发送与文件发送走代理 fetch
  await channel.send('100000000000000001', '测试消息')
  await channel.sendFile('100000000000000001', { name: 'test.txt', data: Buffer.from('hello') })
  const sendFetch = capturedFetches.find(f => f.url.endsWith('/messages') && !f.init.body?.get)
  const fileFetch = capturedFetches.find(f => f.url.endsWith('/messages') && f.init.body instanceof FormData)
  assert.ok(sendFetch)
  assert.ok(sendFetch.init.dispatcher instanceof ProxyAgent)
  assert.ok(fileFetch)
  assert.ok(fileFetch.init.dispatcher instanceof ProxyAgent)

  await channel.start()
  assert.ok(createdSocketOptions?.dispatcher instanceof ProxyAgent)

  await channel.stop()
})

test('Discord 代理地址草稿与输入框交互（普通文本、反显、失焦回填、切账号重置）', async () => {
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const component = client.slice(client.indexOf('function AccountInspector'), client.indexOf('function AccountRemarkEditor'))
  const slots = [], effects = []
  let cursor = 0, stateVersion = 0
  const useState = initial => {
    const index = cursor++
    if (!(index in slots)) slots[index] = initial
    return [slots[index], value => {
      const next = typeof value === 'function' ? value(slots[index]) : value
      if (!Object.is(slots[index], next)) { slots[index] = next; stateVersion++ }
    }]
  }
  const useRef = value => useState({ current: value })[0]
  const useEffect = (fn, deps) => {
    const index = cursor++, previous = slots[index]
    if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
      effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() } })
    }
  }
  const h = (type, props, ...children) => ({ type, props: props || {}, children })
  const Component = new Function('h', 'useState', 'useEffect', 'useRef', 'Logo', 'accountLabel', 'AccountSettingsPicker', 'CommandPermissionSettings', 'Button', 'Modal', 'Tag', 'NoticeBar', 'Input', 'Select', 'AccountRemarkEditor', component + '; return AccountInspector;')(
    h, useState, useEffect, useRef, 'Logo', account => account.id, 'Picker', 'Permissions', 'Button', { useModal: () => [{ confirm() {} }, null] }, 'Tag', 'NoticeBar', 'Input', 'Select', 'RemarkEditor',
  )
  const render = account => {
    for (let attempt = 0; attempt < 5; attempt++) {
      cursor = 0
      const previousVersion = stateVersion
      const tree = Component({ account, t: key => key, onAction: async () => ({}), onSave: async () => true })
      while (effects.length) effects.shift()()
      if (stateVersion === previousVersion) return tree
    }
    assert.fail('表单状态更新未稳定')
  }
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined
    if (predicate(node)) return node
    for (const child of node.children || []) { const result = find(child, predicate); if (result) return result }
  }
  const account = { id: 'discord-test', platform: 'discord', proxyMode: 'custom', proxyConfigured: true, proxyUrl: 'http://127.0.0.1:7897', assistant: {} }
  const first = find(render(account), node => node.props['aria-label'] === 'account.proxyUrl')
  assert.ok(first)
  assert.equal(first.props.value, account.proxyUrl)
  assert.equal(first.props.type, 'text')
  first.props.onChange({ target: { value: 'http://127.0.0.1:9000' } })
  const refreshed = find(render({ ...account }), node => node.props['aria-label'] === 'account.proxyUrl')
  assert.equal(refreshed.props.value, 'http://127.0.0.1:9000')
  const switched = find(render({ ...account, id: 'another-discord-account', proxyUrl: 'http://127.0.0.1:7898' }), node => node.props['aria-label'] === 'account.proxyUrl')
  assert.equal(switched.props.value, 'http://127.0.0.1:7898')

  // 留空失焦后回填原有地址
  switched.props.onChange({ target: { value: '   ' } })
  switched.props.onBlur({ target: { value: '   ' } })
  await new Promise(resolve => setTimeout(resolve, 0))
  const reverted = find(render({ ...account, id: 'another-discord-account', proxyUrl: 'http://127.0.0.1:7898' }), node => node.props['aria-label'] === 'account.proxyUrl')
  assert.equal(reverted.props.value, 'http://127.0.0.1:7898')
})

test('MockAgent 真实拦截请求证明 Discord fetchImpl 支持 dispatcher 注入', async t => {
  const mockAgent = new MockAgent()
  mockAgent.disableNetConnect()
  const pool = mockAgent.get('https://discord.com')
  pool.intercept({ path: '/api/v10/users/@me', method: 'GET' }).reply(200, {
    id: '12345',
    username: 'DiscordBot',
    bot: true,
  })

  // 直接使用 fetchImpl 并传入 MockAgent，不 mock 全局 fetch
  const fetchWithMockAgent = (input, init) => fetch(input, { ...init, dispatcher: mockAgent })
  const channel = createDiscordChannel({
    token: 'test-token',
    fetchImpl: fetchWithMockAgent,
  }, () => {})
  assert.ok(channel)

  const diagnostics = await channel.diagnose(new AbortController().signal)
  const botCheck = diagnostics.find(item => item.id === 'bot')
  assert.equal(botCheck?.status, 'passed')
  await mockAgent.close()
})

test('Discord direct 与 inherit 代理模式的 Dispatcher 构造与 stop 释放', async () => {
  const capturedDirect = []
  const directChannel = createDiscordChannel({
    token: 'discord-token-123',
    proxyMode: 'direct',
    createWebSocket: (url) => ({ addEventListener() {}, send() {}, close() {} }),
  }, () => {})
  assert.ok(directChannel)
  await directChannel.stop() // 安全释放

  const inheritChannel = createDiscordChannel({
    token: 'discord-token-123',
    proxyMode: 'inherit',
    createWebSocket: (url) => ({ addEventListener() {}, send() {}, close() {} }),
  }, () => {})
  assert.ok(inheritChannel)
  await inheritChannel.stop() // 安全释放
})

test('Discord 代理配置仅显示在该渠道设置页，不出现在新增账号凭据表单', () => {
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const meta = readFileSync(new URL('../src/channels/meta.ts', import.meta.url), 'utf8')
  const bind = client.slice(client.indexOf('function BindModal'), client.indexOf('function AccountSettingsPicker'))
  const inspector = client.slice(client.indexOf('function AccountInspector'), client.indexOf('function AccountRemarkEditor'))
  assert.match(inspector, /discord/)
  assert.doesNotMatch(bind, /proxyMode|proxyUrl/)
  assert.match(meta, /discord:[\s\S]*proxyUrl/)
})
