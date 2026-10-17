import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = source.indexOf('      const onAddWorkspace = () => {')
const end = source.indexOf('      const selectPermission', start)
test('不提供手动输入路径弹窗，严格禁止手输路径', () => {
  assert.doesNotMatch(source, /layerOwner: "add-workspace"/, '不允许存在手动输入工作区路径的弹窗')
  assert.doesNotMatch(source, /placeholder: t\("composer\.workspacePath"\)/, '不允许存在工作区路径输入框')
})

for (const mode of ['missing', 'unavailable', 'empty', 'throw', 'reject', 'selected']) {
  test(`添加工作区只走原生目录选择器：${mode}`, async () => {
    let hint = ''
    const created = []
    const pickDirectory = mode === 'missing' ? undefined : () => {
      if (mode === 'unavailable') return Promise.reject(Object.assign(new Error('unavailable'), { code: 'workspace/picker-unavailable' }))
      if (mode === 'throw') throw new Error('unavailable')
      if (mode === 'reject') return Promise.reject(new Error('unavailable'))
      return mode === 'selected' ? 'D:\\Work' : null
    }
    const handler = new Function('props', 'setHint', 'setAddBusy', 't', 'addWorkspace', source.slice(start, end) + '\nreturn onAddWorkspace;')(
      { pickDirectory }, value => { hint = value }, () => {}, key => key, async value => { created.push(value) },
    )
    const pending = handler()
    await pending
    if (mode === 'selected') {
      assert.deepEqual(created, ['D:\\Work'])
      assert.equal(hint, '')
    } else if (mode === 'empty') {
      assert.deepEqual(created, [])
      assert.equal(hint, '')
    } else if (mode === 'unavailable') {
      assert.deepEqual(created, [])
      assert.equal(hint, 'error.workspaceUnavailable', '宿主没有原生选择器时必须提示无法新增，而不是静默无响应')
    } else {
      assert.deepEqual(created, [])
      assert.ok(hint !== '', '无原生选择器或失败时通过 hint 给出提示，不提供手输弹窗')
    }
  })
}

test('Select 组件支持 footer 与 onFooter，点击 footer 触发回调且不触发 onChange', () => {
  assert.match(source, /const footer = React\.useMemo\(\(\) => \{/)
  assert.match(source, /\.\.\.\(footer \? \{ footer \} : \{\}\)/)
  assert.match(source, /if \(props\.footer && props\.footer\.some\(\(item\) => String\(item\.value\) === id\)\) \{/)
})

function loadPicker() {
  const helperStart = source.indexOf('    function parsePickedPath(value) {')
  const helperEnd = source.indexOf('    function activeSessionRefusal', helperStart)
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'client.js 中缺少 parsePickedPath 或 pickHostDirectory')
  return new Function('probeService', 'globalThis', source.slice(helperStart, helperEnd) + '\nreturn { parsePickedPath, pickHostDirectory };')
}

test('pickHostDirectory 优先使用桌面原生 __DSH_DIRECTORY_PICKER__ 并解析对象路径', async () => {
  const load = loadPicker()
  const pick = load(() => undefined, { __DSH_DIRECTORY_PICKER__: { pick: async () => ({ filePaths: ['D:\\Work'] }) } }).pickHostDirectory
  assert.equal(await pick({}), 'D:\\Work')
  const cancel = load(() => undefined, { __DSH_DIRECTORY_PICKER__: { pick: async () => ({ canceled: true }) } }).pickHostDirectory
  assert.equal(await cancel({}), undefined, '用户取消选择应视为未选择，不能当作失败')
})

test('没有任何原生选择器时显式拒绝，避免点击“添加工作区”后无响应', async () => {
  const { pickHostDirectory } = loadPicker()(() => undefined, {})
  await assert.rejects(() => pickHostDirectory({ workspaces: {} }), (error) => error.code === 'workspace/picker-unavailable')
})
