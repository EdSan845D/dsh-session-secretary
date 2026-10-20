import assert from 'node:assert/strict'
import test from 'node:test'
import { Config } from '../lib/index.js'

test('话题命名配置默认 once，保留 follow/off 并拒绝无效值', () => {
  assert.equal(Config({}).topicNaming, 'once')
  for (const topicNaming of ['once', 'follow', 'off']) {
    assert.equal(Config({ topicNaming }).topicNaming, topicNaming)
  }
  assert.throws(() => Config({ topicNaming: 'invalid' }))
})
