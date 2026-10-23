import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import ts from 'typescript'

/** 抽取生产函数，避免测试自行重写更新器逻辑。 */
function functionSource(source, name) {
  const file = ts.createSourceFile('client.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let found
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(found, `必须找到 ${name}`)
  return found
}

function fixture() {
  let enabled = false
  let requests = 0
  const element = () => ({
    children: [], dataset: {}, className: '', textContent: '', isConnected: true,
    append(child) { child.parent = this; this.children.push(child) },
    remove() { this.isConnected = false; if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1) },
    querySelector(selector) {
      if (selector.includes('.mpi-version')) return this.children.find(node => node.className === 'mpi-version') ?? null
      if (selector.includes('[data-mpi-check')) return this.children.find(node => node.dataset.mpiCheck) ?? null
      return null
    },
  })
  const heading = element()
  const links = element()
  const row = { querySelector: selector => selector === 'h1,h2' ? heading : links }
  const document = { body: element(), documentElement: { lang: 'zh' }, createElement: element,
    querySelector: () => row, querySelectorAll: () => [...heading.children, ...links.children] }
  const window = new EventTarget()
  const source = readFileSync(new URL('../src/plugin-update-ui.js', import.meta.url), 'utf8')
  const observe = new Function('document', 'window', 'MutationObserver', 'React', 'ReactDOM', 'ensureStyle',
    'resolveApiUrl', 'requestStatus', 'pluginUpdateCopy', 'UpdatePrimitiveButton', 'HostIcon', 'UpdateDialog', 'createUpdateFlow',
    functionSource(source, 'observePluginUpdate') + '\nreturn observePluginUpdate;')(
    document, window, class { observe() {} disconnect() {} }, { createElement: () => null },
    { createRoot: () => ({ render() {}, unmount() {} }) }, () => {}, path => path,
    async () => {
      requests++
      if (!enabled) throw new Error('在线更新已被禁用')
      return { currentVersion: '1.0.13' }
    }, () => ({ check: '检查更新' }), () => null, () => null, () => null, () => null,
  )
  const cleanup = observe({ endpoint: '/update', packageName: '@michengai/dsh-im-connect', titleRowSelector: '.title', linksSelector: '.links', createIcon: () => ({}), isEnabled: () => enabled })
  return { heading, links, cleanup, requests: () => requests, toggle(value) { enabled = value; window.dispatchEvent(new Event('ima-update-toggle')) } }
}

test('启动时更新被禁用，开启后重新读取版本并恢复提示，关闭后清理', async () => {
  const f = fixture()
  try {
    await setImmediate()
    assert.equal(f.heading.children.length, 0)
    f.toggle(true)
    await setImmediate()
    assert.equal(f.heading.children[0]?.textContent, 'v1.0.13', '初次读取失败不能使开启后的版本提示永久缺失')
    assert.equal(f.links.children.length, 1)
    f.toggle(false)
    assert.equal(f.heading.children.length, 0)
    assert.equal(f.links.children.length, 0)
    f.toggle(true)
    await setImmediate()
    assert.equal(f.heading.children[0]?.textContent, 'v1.0.13')
    assert.equal(f.links.children.length, 1)
  } finally { f.cleanup() }
})

test('在线更新保存成功后再次通知，确保版本读取发生在服务端开启之后', async () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const start = source.indexOf('      const setOnlineUpdate = async (next) => {')
  const end = source.indexOf('      const loadEpoch', start)
  assert.ok(start >= 0 && end > start)
  let finish
  let saved = false
  const notifications = []
  const setOnlineUpdate = new Function('callApi', 'options',
    'let onlineUpdateLocked = false, onlineUpdateEnabled = false, updateEpoch = 0; const notify = () => {};\n' + source.slice(start, end) + '\nreturn setOnlineUpdate;')(
    () => new Promise(resolve => { finish = () => { saved = true; resolve({ enabled: true }) } }),
    { onOnlineUpdateChange: () => notifications.push(saved) },
  )
  const pending = setOnlineUpdate(true)
  assert.deepEqual(notifications, [false], '保留即时界面反馈')
  finish()
  await pending
  assert.equal(notifications.at(-1), true, '必须在持久化完成后触发一次读取通知')
})
