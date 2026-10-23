import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import test from 'node:test'
import { ChannelManager } from '../lib/manager.js'

test('侧边栏入口配置：管理器方法、持久化与 HTTP API', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-im-sidebar-test-'))
  const stateDir = join(temporary, 'state')

  try {
    const mockCtx = {
      permissionPresets: { names: ['review'], defaultPreset: 'review', optionOf: (name) => ({ value: name, name }) },
      logger: () => ({ info() {}, warn() {}, error() {} }),
      get: (name) => {
        if (name === 'connection') {
          return { requestRejection: () => undefined }
        }
        return undefined
      },
    }
    const engineConfig = {
      cwd: process.cwd(),
      provider: 'test-p',
      model: 'test-m',
      agentPreset: 'standard',
      mergeTimeoutSecs: 5,
      permissionPreset: 'read-only',
      topicNaming: 'once',
    }

    // 1. 默认值与管理器方法测试
    const manager = new ChannelManager({
      ctx: mockCtx,
      stateDir,
      log: () => {},
      engineConfig,
    })

    assert.equal(typeof manager.getSidebarEntry, 'function', 'manager 提供 getSidebarEntry')
    assert.equal(typeof manager.setSidebarEntry, 'function', 'manager 提供 setSidebarEntry')
    assert.equal(manager.getSidebarEntry(), false, 'sidebarEntry 默认关闭（false）')

    const enabled = await manager.setSidebarEntry(true)
    assert.equal(enabled, true, 'setSidebarEntry(true) 返回 true')
    assert.equal(manager.getSidebarEntry(), true, 'getSidebarEntry() 返回已更新的 true')

    const disabled = await manager.setSidebarEntry(false)
    assert.equal(disabled, false, 'setSidebarEntry(false) 返回 false')
    assert.equal(manager.getSidebarEntry(), false, 'getSidebarEntry() 返回已更新的 false')

    // 非布尔值校验
    await assert.rejects(
      async () => manager.setSidebarEntry('true'),
      (err) => err instanceof Error,
      '非布尔值拒绝写入',
    )

    // 2. HTTP 路由测试
    let route
    const serverCtx = {
      ...mockCtx,
      webServer: {
        register(val) {
          if (val.kind === 'prefix') route = val
          return () => {}
        },
      },
    }
    manager.registerApi(serverCtx)
    assert.ok(route, 'API 路由必须成功注册')

    const server = createServer((req, res) => route.handler(req, res))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/dsh-im-connect/sidebar-entry`
    const headers = { 'content-type': 'application/json', 'x-dsh-im-connect-client': '1' }

    try {
      // GET 初始状态（false）
      const getRes = await fetch(baseUrl)
      assert.equal(getRes.status, 200)
      const getData = await getRes.json()
      assert.equal(getData.ok, true)
      assert.equal(getData.enabled, false, 'HTTP GET 默认 enabled 为 false')

      // POST 更新开启
      const postRes = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ enabled: true }),
      })
      assert.equal(postRes.status, 200)
      const postData = await postRes.json()
      assert.equal(postData.ok, true)
      assert.equal(postData.enabled, true)

      // GET 验证更新已生效
      const getRes2 = await fetch(baseUrl)
      const getData2 = await getRes2.json()
      assert.equal(getData2.ok, true)
      assert.equal(getData2.enabled, true)

      // POST 非法参数校验
      const postInvalid = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ enabled: 'yes' }),
      })
      assert.equal(postInvalid.status, 400)

      // HEAD 请求
      const headRes = await fetch(baseUrl, { method: 'HEAD' })
      assert.equal(headRes.status, 200)

      // 缺少客户端标记返回 403
      const postForbidden = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
      assert.equal(postForbidden.status, 403)

      // 不支持的 HTTP 方法返回 405
      const putRes = await fetch(baseUrl, { method: 'PUT', headers })
      assert.equal(putRes.status, 405)
    } finally {
      server.close()
    }

    // 3. 跨重启持久化检查
    const manager2 = new ChannelManager({
      ctx: mockCtx,
      stateDir,
      log: () => {},
      engineConfig,
    })
    assert.equal(manager2.getSidebarEntry(), true, '跨重启后正确读回已保存的 sidebarEntry=true')
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
  }
})
