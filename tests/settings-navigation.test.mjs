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
