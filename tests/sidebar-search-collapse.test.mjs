import assert from 'node:assert/strict'
import test from 'node:test'
import { createImShellHarness } from './sidebar-shell-harness.mjs'

test('IM 外壳收起时(wide: false)阻断官方任务树因搜索请求而在首帧挂载时误调用 expandSidebar 导致侧栏自动弹回', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, val) => values.set(key, String(val)),
    removeItem: key => values.delete(key),
  }
  const shell = createImShellHarness(storage)

  let expandSidebarCalls = 0
  let searchRequest = 0

  const MockOfficialWorkspaceBrowser = props => {
    if (props.wide === false && searchRequest > 0) {
      if (typeof props.expandSidebar === 'function') {
        props.expandSidebar()
      }
    }
    return { type: 'mock-official-tree', props }
  }

  const hostProps = {
    expandSidebar: () => {
      expandSidebarCalls++
    },
  }

  // 1. 展开状态下渲染
  shell.render({
    officialTree: MockOfficialWorkspaceBrowser,
    wide: true,
    ...hostProps,
  })

  // 2. 模拟用户搜索产生 searchRequest > 0
  searchRequest = 1

  // 3. 用户收起侧栏，传入 wide: false
  assert.equal(expandSidebarCalls, 0)
  const narrowTree = shell.render({
    officialTree: MockOfficialWorkspaceBrowser,
    wide: false,
    ...hostProps,
  })

  // 执行 Official 模拟组件初次挂载
  if (typeof narrowTree.type === 'function') {
    narrowTree.type(narrowTree.props)
  }

  // 4. 断言：收起侧边栏时不应误触发 expandSidebar
  assert.equal(expandSidebarCalls, 0, 'IM 侧栏收起时不应调用 expandSidebar，防止侧栏自动弹回！')
})
