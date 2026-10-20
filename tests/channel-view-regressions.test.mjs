import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { extractBlock } from './sidebar-lifecycle-harness.mjs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const viewCode = extractBlock(source, '    function ChannelOfficialView(props)', '    const registryFilterCache', '频道视图')
const storeCode = extractBlock(source, '    function copySessionOrders(', '    const channelSessionStateCache', '频道状态')
const canArchiveCode = extractBlock(source, '    function canArchiveChannelGroup(', '    async function archiveChannelGroup(', '归档能力')

// 执行真实组件函数，保留跨渲染的 hook 状态；按宿主行为检查传给官方树的数据。
function fixture() {
  const { createChannelViewStore } = new Function(`${storeCode}; return { createChannelViewStore };`)()
  const store = createChannelViewStore()
  const states = [], effects = []
  let cursor = 0, listener, menu
  const Official = () => {}
  const h = (type, props, ...children) => ({ type, props: { ...props, children } })
  const env = {
    document: {},
    React: { Fragment: 'fragment' }, h,
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next }]
    },
    useRef: value => ({ current: value }), useMemo: fn => fn(), useCallback: fn => fn,
    useSyncExternalStore: (_, snapshot) => snapshot(), useEffect: fn => { effects.push(fn) },
    getChannelViewStore: () => store, subscribeChannelMembership() {}, channelMembershipSnapshot: () => 0,
    ensureStyle() {}, channelRefresh: { subscribe(fn) { listener = fn; return () => {} } },
    channelIconCss: () => '', hasArchiveManagerPlugin: () => true,
    channelWorkspaceId: id => `dsh-im-channel:${id}`, channelWorkspaceIconCss: () => '',
    installChannelGroupOption: () => () => {}, installChannelGroupMenu: options => { menu = options; return () => {} },
    ChannelTreeGuard: 'guard', ChannelUnavailable: 'unavailable', Modal: 'modal',
    fallbackT: key => key, serverText: text => text, hostModalButton() {}, noopChannelAction() {}, channelAddFlow() {},
  }
  const View = new Function(...Object.keys(env), `${canArchiveCode}\n${viewCode}; return ChannelOfficialView;`)(...Object.values(env))
  const props = {
    t: key => key, officialTree: Official, openImSettings() {},
    hostProps: { useSessions: select => select({ ids: [], byId: {} }), useWorkspaces: select => select({ items: [], phase: 'ready' }), archiveSession: async () => {} },
  }
  const render = () => {
    cursor = 0
    effects.length = 0
    const tree = View(props)
    return { tree, effects: [...effects] }
  }
  return { store, render, props, get menu() { return menu }, receive: data => listener(data, null) }
}

test('实际频道组件在归档服务存在时向菜单开放归档整组', () => {
  const f = fixture()
  const first = f.render()
  first.effects.forEach(fn => fn())
  assert.equal(f.menu.canArchive, true)
})

test('首个频道快照到达前不挂载官方树，切回页签保留折叠和排序', () => {
  const f = fixture()
  const key = 'dsh-im-channel:wecom'
  f.store.actions.setGroupExpanded(key, false)
  f.store.actions.setSessionOrder(key, ['b', 'a'], {})
  const first = f.render()
  const body = first.tree.props.children[0].props.children.at(-1)
  assert.equal(body, null, '尚未加载时不能让官方树把空列表作为权威数据清理状态')
  first.effects.forEach(fn => fn())
  f.receive({ ok: true, groups: [{ id: 'wecom', sessions: [{ sessionId: 'a' }, { sessionId: 'b' }] }] })
  const ready = f.render()
  assert.equal(ready.tree.props.children[0].props.children.at(-1).type, 'guard')
  ready.effects.forEach(fn => fn())
  // 官方树就绪后只保留仍存在的分组。
  f.store.actions.retainAccountKeys(['', '__flat_session_order__', key])
  assert.equal(f.store.getSnapshot().groupExpansion[key], false)
  assert.deepEqual(f.store.getSnapshot().sessionOrderByAccount[key], ['b', 'a'])
})

test('加载失败不开放空快照，成功返回空频道时允许官方树清理已移除分组', () => {
  const f = fixture()
  const first = f.render()
  first.effects.forEach(fn => fn())
  f.receive({ ok: false, error: '连接失败' })
  assert.equal(f.render().tree.props.children[0].props.children.at(-1), null)
  f.receive({ ok: true, groups: [] })
  assert.equal(f.render().tree.props.children[0].props.children.at(-1).type, 'guard')
})
