import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockAgent, ProxyAgent } from 'undici'
import { ChannelManager } from '../lib/manager.js'
import { createTelegramChannel } from '../lib/channels/telegram.js'

function makeManager(t, stateDir = mkdtempSync(join(tmpdir(), 'im-connect-proxy-'))) {
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

async function createAccount(manager) {
  return manager.connect('telegram', { token: 'test-token' }, {
    provider: 'test', model: 'test', cwd: tmpdir(), permission: 'review', privateAccess: 'approved',
  })
}

test('Telegram 代理地址可在账号设置快照中反显，且仍存放在凭据库', async t => {
  const stateDir = mkdtempSync(join(tmpdir(), 'im-connect-proxy-'))
  const manager = makeManager(t, stateDir)
  const created = await createAccount(manager)
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

  // 模拟凭据库记录意外丢失，proxyConfigured 降级为 false 引导重新填写
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
  const created = await createAccount(manager)
  assert.equal(created.ok, true)

  for (const [proxyMode, proxyUrl] of [
    ['unknown', 'http://127.0.0.1:7897'],
    ['custom', 'socks5://127.0.0.1:7897'],
    ['custom', 'http://127.0.0.1:7897/path'],
    ['custom', 'http://alice:secret@127.0.0.1:7897'],
    ['custom', 'not a URL'],
  ]) {
    const result = await manager.updateAccount(created.accountId, { proxyMode, proxyUrl })
    assert.equal(result.ok, false, `${proxyMode} ${proxyUrl}`)
  }
  const account = manager.list().flatMap(channel => channel.accounts).find(item => item.id === created.accountId)
  assert.equal(account.proxyMode, 'inherit')
  assert.equal(account.proxyConfigured, false)
})

test('非 Telegram 账号不能保存渠道代理设置', async t => {
  const manager = makeManager(t)
  const created = await manager.connect('qq', { appId: 'test-app', appSecret: 'test-secret' }, {
    provider: 'test', model: 'test', cwd: tmpdir(), permission: 'review', privateAccess: 'approved',
  })
  assert.equal(created.ok, true)
  const result = await manager.updateAccount(created.accountId, { proxyMode: 'direct' })
  assert.equal(result.ok, false)
})

test('Telegram 代理配置仅显示在该渠道设置页，不出现在新增账号凭据表单', () => {
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const meta = readFileSync(new URL('../src/channels/meta.ts', import.meta.url), 'utf8')
  const bind = client.slice(client.indexOf('function BindModal'), client.indexOf('function AccountSettingsPicker'))
  const inspector = client.slice(client.indexOf('function AccountInspector'), client.indexOf('function AccountRemarkEditor'))
  assert.match(inspector, /account\.platform === "telegram"/)
  assert.match(inspector, /proxyMode/)
  assert.match(inspector, /proxyUrl/)
  const proxyInputValue = inspector.indexOf('value: proxyUrlDraft')
  const proxyInput = inspector.slice(inspector.lastIndexOf('h(Input, {', proxyInputValue), inspector.indexOf('}),', proxyInputValue))
  assert.match(proxyInput, /type:\s*"text"/)
  assert.doesNotMatch(proxyInput, /type:\s*"password"/)
  assert.doesNotMatch(bind, /proxyMode|proxyUrl/)
  assert.match(meta, /telegram:[\s\S]*proxyUrl/)
})

test('Telegram 代理地址草稿不会被账号状态刷新清空', async () => {
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
  const account = { id: 'telegram-test', platform: 'telegram', proxyMode: 'custom', proxyConfigured: true, proxyUrl: 'http://127.0.0.1:7897', assistant: {} }
  const first = find(render(account), node => node.props['aria-label'] === 'account.proxyUrl')
  assert.ok(first)
  assert.equal(first.props.value, account.proxyUrl)
  first.props.onChange({ target: { value: 'http://127.0.0.1:9000' } })
  const refreshed = find(render({ ...account }), node => node.props['aria-label'] === 'account.proxyUrl')
  assert.equal(refreshed.props.value, 'http://127.0.0.1:9000')
  const switched = find(render({ ...account, id: 'another-telegram-account', proxyUrl: 'http://127.0.0.1:7898' }), node => node.props['aria-label'] === 'account.proxyUrl')
  assert.equal(switched.props.value, 'http://127.0.0.1:7898')

  // 留空失焦后回填原有地址
  switched.props.onChange({ target: { value: '   ' } })
  switched.props.onBlur({ target: { value: '   ' } })
  await new Promise(resolve => setTimeout(resolve, 0))
  const reverted = find(render({ ...account, id: 'another-telegram-account', proxyUrl: 'http://127.0.0.1:7898' }), node => node.props['aria-label'] === 'account.proxyUrl')
  assert.equal(reverted.props.value, 'http://127.0.0.1:7898')
})

test('Telegram API、文件上传和诊断共用手动代理且停止时释放 dispatcher', async t =>
 {
  t.after(() => mock.restoreAll())
  const captured = []
  mock.method(globalThis, 'fetch', async (url, init = {}) => {
    captured.push({ url: String(url), init })
    if (String(url).endsWith('/getMe')) return Response.json({ ok: true, result: { id: 1, is_bot: true } })
    if (String(url).endsWith('/getWebhookInfo')) return Response.json({ ok: true, result: { url: '' } })
    return Response.json({ ok: true, result: true })
  })
  const channel = createTelegramChannel({ token: 'test-token', proxyMode: 'custom', proxyUrl: 'http://127.0.0.1:7897' }, () => {})
  assert.ok(channel)
  await channel.send('chat', 'hello')
  await channel.sendFile('chat', { name: 'note.txt', data: Buffer.from('hello') })
  const diagnostics = await channel.diagnose(new AbortController().signal)
  assert.equal(diagnostics.every(item => item.status === 'passed'), true)
  assert.equal(captured.length, 4)
  for (const request of captured) assert.ok(request.init.dispatcher instanceof ProxyAgent, request.url)
  await channel.stop()
})

test('代理配置未变时不重复重启通道，真正变更或切回 inherit 时才重启', async t => {
  const manager = makeManager(t)
  const created = await createAccount(manager)
  assert.equal(created.ok, true)

  const proxyUrl = 'http://127.0.0.1:7897/'
  const first = await manager.updateAccount(created.accountId, {
    proxyMode: 'custom',
    proxyUrl: 'http://127.0.0.1:7897',
  })
  assert.equal(first.ok, true)
  assert.equal(first.account.proxyUrl, proxyUrl)

  // 模拟通道正在运行
  manager.running.set(created.accountId, { stop: async () => {}, status: () => '已连接' })

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

test('MockAgent 真实拦截请求证明 Node 内置 fetch 支持 dispatcher 注入', async t => {
  const mockAgent = new MockAgent()
  mockAgent.disableNetConnect()
  const pool = mockAgent.get('https://api.telegram.org')
  pool.intercept({ path: '/botmock-token/getMe', method: 'GET' }).reply(200, {
    ok: true,
    result: { id: 12345, is_bot: true, first_name: 'MockBot', username: 'mock_bot' },
  })

  // 不 mock globalThis.fetch，直接调用 Node 内置原生 fetch 验证 dispatcher 消费
  const res = await fetch('https://api.telegram.org/botmock-token/getMe', { dispatcher: mockAgent })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.result.id, 12345)
  await mockAgent.close()
})
