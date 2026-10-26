import assert from 'node:assert/strict'
import test from 'node:test'
import { Config } from '../../lib/index.js'

test('secretary 配置组默认值', () => {
  const resolved = Config({})
  assert.deepEqual(resolved.secretary, {
    notifyQuestion: true,
    notifyApproval: true,
    notifyCompletion: true,
    notifyError: true,
    labelPrefix: true,
    intentParse: true,
    controlChatId: '',
    pendingTtlMinutes: 1440,
    maxForwardChars: 1200,
  })
})

test('secretary 配置可覆盖且不影响上游字段', () => {
  const resolved = Config({ secretary: { notifyQuestion: false, controlChatId: 'c1' }, provider: 'p', model: 'm' })
  assert.equal(resolved.secretary.notifyQuestion, false)
  assert.equal(resolved.secretary.controlChatId, 'c1')
  assert.equal(resolved.provider, 'p')
  assert.equal(resolved.model, 'm')
})

test('通知通道组默认值（v2.0 系统通道默认开：client 半边延期到 v2.1）', () => {
  const plain = Config({})
  assert.equal(plain.system.enabled, true)
  assert.equal(plain.browser.enabled, true)
  assert.equal(plain.browser.onlyWhenHidden, true)
})

test('updater 默认禁用', () => {
  const resolved = Config({})
  assert.equal(resolved.updater, false)
  assert.equal(resolved.onlineUpdate, false)
})
