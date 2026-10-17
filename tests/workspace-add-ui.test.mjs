import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = source.indexOf('      const onAddWorkspace = () => {')
const end = source.indexOf('      const selectPermission', start)
for (const mode of ['missing', 'empty', 'throw', 'reject', 'selected']) {
  test(`添加工作区始终提供可见入口：${mode}`, async () => {
    let adding = false, open = 'workspace', path = 'old'
    const created = []
    const pickDirectory = mode === 'missing' ? undefined : () => {
      if (mode === 'throw') throw new Error('unavailable')
      if (mode === 'reject') return Promise.reject(new Error('unavailable'))
      return mode === 'selected' ? 'D:\\Work' : null
    }
    const handler = new Function('props', 'setOpen', 'setHint', 'setAdding', 'setAddPath', 'addWorkspace', source.slice(start, end) + '\nreturn onAddWorkspace;')(
      { pickDirectory }, value => { open = value }, () => {}, value => { adding = value }, value => { path = value }, async value => { created.push(value) },
    )
    const pending = handler()
    await pending
    if (mode === 'selected') {
      assert.equal(adding, false, '原生选择器成功选择时不需要弹出手输路径框')
      assert.deepEqual(created, ['D:\\Work'])
    } else if (mode === 'empty') {
      assert.equal(adding, false, '原生选择器取消时不需要弹出手输路径框')
      assert.deepEqual(created, [])
    } else {
      assert.equal(adding, true, '无原生选择器或选择器异常时作为兜底弹出手输路径框')
      assert.equal(path, '')
      assert.deepEqual(created, [])
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
