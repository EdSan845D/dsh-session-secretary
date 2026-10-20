import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { extractBlock } from './sidebar-lifecycle-harness.mjs'

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const code = extractBlock(
  client,
  '    function pickSettingsSectionButton(',
  '    const EMPTY_EXTRA_TABS = [];',
  '设置导航',
)

test('设置入口按 aria-label 和去空格标签选中 IM 分区', () => {
  const clicks = []
  const launcher = {
    textContent: '',
    getAttribute: name => name === 'aria-label' ? '设置' : null,
    click: () => { clicks.push('settings') },
  }
  const section = {
    textContent: 'IM 助理',
    getAttribute: () => null,
    click: () => { clicks.push('im') },
  }
  const document = {
    body: {},
    querySelector: () => null,
    querySelectorAll: selector => {
      if (selector === 'button') return [launcher, section]
      if (selector.includes('aria-haspopup') || selector.includes('aria-label')) return [launcher]
      if (selector.includes('nav button')) return [section]
      return []
    },
  }
  const window = {
    requestAnimationFrame: callback => { callback(); return 1 },
    cancelAnimationFrame: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
  }
  class Observer {
    observe() {}
    disconnect() {}
  }
  const open = new Function(
    'document', 'window', 'MutationObserver',
    'SETTINGS_CODEX_TRIGGER_SELECTOR', 'SETTINGS_CODEX_PAGE_SELECTOR', 'SETTINGS_OPEN_SECTION_EVENT',
    `${code}; return openSettingsSection;`,
  )(document, window, Observer, '[data-dcu-settings-trigger]', '[data-dcu-settings-page]', 'dcu-settings-open-section')
  let selected = false
  open(['IM助理'], () => { selected = true }, () => assert.fail('不应回退到缺失提示'))
  assert.deepEqual(clicks, ['settings', 'im'])
  assert.equal(selected, true)
})

test('官方账号菜单提供设置入口时先展开菜单再选中 IM 分区', () => {
  const clicks = []
  let menuOpen = false
  let pageOpen = false
  const accountMenu = {
    getAttribute: name => name === 'aria-label' ? '账号菜单' : null,
    textContent: '',
    click: () => { menuOpen = true; clicks.push('menu') },
  }
  const menuItem = {
    textContent: '设置',
    getAttribute: () => null,
    click: () => { menuOpen = false; pageOpen = true; clicks.push('settings') },
  }
  const section = {
    textContent: 'IM 助理',
    getAttribute: () => null,
    click: () => { clicks.push('im') },
  }
  const document = {
    body: {},
    querySelector: selector => {
      if (selector === 'button[aria-label="账号菜单"]') return accountMenu
      if (selector === '[role="dialog"]') return null
      if (selector === '[data-dcu-settings-page]') return pageOpen ? {} : null
      if (selector === '[data-dcu-settings-trigger]') return null
      return null
    },
    querySelectorAll: selector => {
      if (selector === '[role="menuitem"], [role="menu"] button') return menuOpen ? [menuItem] : []
      if (selector === 'button[aria-haspopup="menu"]') return []
      if (selector === 'button') return [accountMenu]
      if (selector.includes('aria-haspopup') || selector.includes('aria-label')) return []
      if (selector.includes('nav button')) return pageOpen ? [section] : []
      return []
    },
  }
  const window = {
    requestAnimationFrame: callback => { callback(); return 1 },
    cancelAnimationFrame: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
  }
  class Observer {
    observe() {}
    disconnect() {}
  }
  const open = new Function(
    'document', 'window', 'MutationObserver',
    'SETTINGS_CODEX_TRIGGER_SELECTOR', 'SETTINGS_CODEX_PAGE_SELECTOR', 'SETTINGS_OPEN_SECTION_EVENT',
    `${code}; return openSettingsSection;`,
  )(document, window, Observer, '[data-dcu-settings-trigger]', '[data-dcu-settings-page]', 'dcu-settings-open-section')
  let selected = false
  open(['IM助理'], () => { selected = true }, () => assert.fail('不应回退到缺失提示'))
  assert.deepEqual(clicks, ['menu', 'settings', 'im'])
  assert.equal(selected, true)
})
