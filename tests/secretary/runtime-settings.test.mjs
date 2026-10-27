import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_FORWARD_CHARS_RANGE,
  PENDING_TTL_RANGE,
  SECRETARY_DEFAULTS,
  mergeSecretarySettings,
  normalizeSecretaryPatch,
} from '../../lib/secretary/runtime-settings.js'

test('mergeSecretarySettings：无覆盖层时返回 Config 默认值', () => {
  const defaults = { ...SECRETARY_DEFAULTS, labelPrefix: false }
  assert.deepEqual(mergeSecretarySettings(defaults, undefined), defaults)
  assert.deepEqual(mergeSecretarySettings(defaults, null), defaults)
  assert.deepEqual(mergeSecretarySettings(defaults, '垃圾数据'), defaults)
  assert.deepEqual(mergeSecretarySettings(defaults, [1, 2]), defaults)
})

test('mergeSecretarySettings：只接受已知且类型正确的覆盖键', () => {
  const merged = mergeSecretarySettings(SECRETARY_DEFAULTS, {
    labelPrefix: false,
    intentParse: false,
    systemEnabled: false,
    pendingTtlMinutes: 60,
    maxForwardChars: 2000,
    controlChatId: 'qq:12345',
    notifyQuestion: 'yes',
    unknownKey: true,
    pendingTtlMinutes2: -5,
  })
  assert.equal(merged.labelPrefix, false)
  assert.equal(merged.intentParse, false)
  assert.equal(merged.systemEnabled, false)
  assert.equal(merged.pendingTtlMinutes, 60)
  assert.equal(merged.maxForwardChars, 2000)
  assert.equal(merged.controlChatId, 'qq:12345')
  assert.equal(merged.notifyQuestion, true, '类型错误的覆盖键被丢弃')
  assert.equal('unknownKey' in merged, false)
})

test('mergeSecretarySettings：越界数值被丢弃', () => {
  const merged = mergeSecretarySettings(SECRETARY_DEFAULTS, {
    pendingTtlMinutes: PENDING_TTL_RANGE.max + 1,
    maxForwardChars: MAX_FORWARD_CHARS_RANGE.min - 1,
  })
  assert.equal(merged.pendingTtlMinutes, SECRETARY_DEFAULTS.pendingTtlMinutes)
  assert.equal(merged.maxForwardChars, SECRETARY_DEFAULTS.maxForwardChars)
})

test('normalizeSecretaryPatch：合法补丁逐键通过', () => {
  const result = normalizeSecretaryPatch({
    notifyQuestion: false,
    notifyApproval: true,
    notifyCompletion: false,
    notifyError: true,
    labelPrefix: false,
    intentParse: false,
    systemEnabled: false,
    controlChatId: ' qq:12345 ',
    pendingTtlMinutes: 30,
    maxForwardChars: 4000,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.patch, {
    notifyQuestion: false,
    notifyApproval: true,
    notifyCompletion: false,
    notifyError: true,
    labelPrefix: false,
    intentParse: false,
    systemEnabled: false,
    controlChatId: 'qq:12345',
    pendingTtlMinutes: 30,
    maxForwardChars: 4000,
  })
})

test('normalizeSecretaryPatch：未知键 / 类型错误 / 越界值拒绝', () => {
  assert.equal(normalizeSecretaryPatch({ nope: true }).ok, false)
  assert.equal(normalizeSecretaryPatch({ notifyQuestion: 'yes' }).ok, false)
  assert.equal(normalizeSecretaryPatch({ pendingTtlMinutes: 0 }).ok, false)
  assert.equal(normalizeSecretaryPatch({ pendingTtlMinutes: 1.5 }).ok, false)
  assert.equal(normalizeSecretaryPatch({ pendingTtlMinutes: PENDING_TTL_RANGE.max + 1 }).ok, false)
  assert.equal(normalizeSecretaryPatch({ maxForwardChars: 100 }).ok, false)
  assert.equal(normalizeSecretaryPatch({ maxForwardChars: MAX_FORWARD_CHARS_RANGE.max + 1 }).ok, false)
  assert.equal(normalizeSecretaryPatch({ controlChatId: 'qq' }).ok, false)
  assert.equal(normalizeSecretaryPatch(null).ok, false)
  assert.equal(normalizeSecretaryPatch([1]).ok, false)
})

test('normalizeSecretaryPatch：controlChatId 允许空串（恢复自动学习）', () => {
  const empty = normalizeSecretaryPatch({ controlChatId: '' })
  assert.equal(empty.ok, true)
  if (empty.ok) assert.deepEqual(empty.patch, { controlChatId: '' })
})

test('normalizeSecretaryPatch：reset 键属于 API 层，到达本层按未知键拒绝', () => {
  assert.equal(normalizeSecretaryPatch({ reset: true }).ok, false)
})
