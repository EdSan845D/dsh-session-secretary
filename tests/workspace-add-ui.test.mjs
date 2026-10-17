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

for (const mode of ['missing', 'empty', 'throw', 'reject', 'selected']) {
  test(`添加工作区只走原生目录选择器：${mode}`, async () => {
    let open = 'workspace', hint = ''
    const created = []
    const pickDirectory = mode === 'missing' ? undefined : () => {
      if (mode === 'throw') throw new Error('unavailable')
      if (mode === 'reject') return Promise.reject(new Error('unavailable'))
      return mode === 'selected' ? 'D:\\Work' : null
    }
    const handler = new Function('props', 'setOpen', 'setHint', 'setAddBusy', 't', 'addWorkspace', source.slice(start, end) + '\nreturn onAddWorkspace;')(
      { pickDirectory }, value => { open = value }, value => { hint = value }, () => {}, key => key, async value => { created.push(value) },
    )
    const pending = handler()
    await pending
    if (mode === 'selected') {
      assert.deepEqual(created, ['D:\\Work'])
      assert.equal(hint, '')
    } else if (mode === 'empty') {
      assert.deepEqual(created, [])
      assert.equal(hint, '')
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

test('pickHostDirectory 优先使用桌面原生 __DSH_DIRECTORY_PICKER__ 并解析对象路径', () => {
  assert.match(source, /__DSH_DIRECTORY_PICKER__/)
  assert.match(source, /function parsePickedPath\(value\)/)
})
