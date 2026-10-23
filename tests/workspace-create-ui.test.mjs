import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const clientPath = process.env.IM_TEST_BUNDLE === '1' ? '../lib/client.js' : '../client.js'
const source = readFileSync(new URL(clientPath, import.meta.url), 'utf8')
const start = source.indexOf('      const addWorkspace = (path) => {')
const end = source.indexOf('      const onAddWorkspace', start)
assert.ok(start >= 0 && end > start, '必须找到实际的工作区创建处理函数')

/** 执行生产表单处理函数，记录回填、提示与忙碌状态，不创建真实工作区。 */
function form(createWorkspace) {
  const state = { hint: '', updates: [], busy: false }
  const add = new Function('props', 'setHint', 'setAddBusy', 'update', 't',
    source.slice(start, end) + '\nreturn addWorkspace;')(
    { createWorkspace },
    value => { state.hint = value },
    value => { state.busy = value },
    patch => { state.updates.push(patch) },
    key => key,
  )
  return { state, add }
}

for (const result of [undefined, null, {}, { path: '' }]) {
  test(`创建没有返回有效工作区时不回填：${JSON.stringify(result)}`, async () => {
    const { state, add } = form(async () => result)
    await add('D:/selected-workspace')
    assert.deepEqual(state.updates, [], '未经宿主确认的路径不得回填为成功结果')
    assert.equal(state.hint, 'error.addWorkspace')
    assert.equal(state.busy, false)
  })
}

for (const mode of ['throw', 'reject']) {
  test(`创建失败显示提示并释放忙碌状态：${mode}`, async () => {
    const { state, add } = form(() => {
      if (mode === 'throw') throw new Error('创建失败')
      return Promise.reject(new Error('创建失败'))
    })
    await assert.doesNotReject(async () => add('D:/selected-workspace'))
    assert.deepEqual(state.updates, [])
    assert.equal(state.hint, '创建失败')
    assert.equal(state.busy, false)
  })
}

for (const result of [{ path: 'D:/registered-workspace' }, { cwd: 'D:/registered-workspace' }]) {
  test(`创建成功使用宿主返回路径：${JSON.stringify(result)}`, async () => {
    const { state, add } = form(async () => result)
    await add('D:/selected-workspace')
    assert.deepEqual(state.updates, [{ cwd: 'D:/registered-workspace' }])
    assert.equal(state.hint, '')
    assert.equal(state.busy, false)
  })
}

// 检查实际注入表达式，不用测试桩替代侧栏和设置页的能力判定。
const file = ts.createSourceFile('client.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const expressions = []
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'createWorkspace'
      && node.initializer.getText(file).includes('ctx.workspaces')) {
    expressions.push(node.initializer.getText(file))
  }
  ts.forEachChild(node, visit)
}
visit(file)
assert.equal(expressions.length, 2, '必须同时覆盖侧栏与设置页注入')

for (const [index, expression] of expressions.entries()) {
  test(`入口 ${index + 1} 缺少宿主创建能力时明确提示、不回填`, async () => {
    const callback = new Function('ctx', 'return (' + expression + ');')({ workspaces: {} })
    const { state, add } = form(callback)
    await add('D:/selected-workspace')
    assert.deepEqual(state.updates, [])
    assert.equal(state.hint, 'error.workspaceUnavailable')
    assert.equal(state.busy, false)
  })

  test(`入口 ${index + 1} 保留宿主方法接收者并传递创建结果`, async () => {
    const ctx = { workspaces: {
      async create(input) {
        assert.equal(this, ctx.workspaces, '不能拆出宿主方法后丢失接收者')
        assert.deepEqual(input, { path: 'D:/selected-workspace' })
        return { path: 'D:/registered-workspace' }
      },
    } }
    const callback = new Function('ctx', 'return (' + expression + ');')(ctx)
    const { state, add } = form(callback)
    await add('D:/selected-workspace')
    assert.deepEqual(state.updates, [{ cwd: 'D:/registered-workspace' }])
    assert.equal(state.hint, '')
  })
}
