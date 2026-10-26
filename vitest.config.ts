import { defineConfig } from 'vitest/config'

/** 移植自 dsh-messager 的秘书测试（vitest）；上游引擎测试走 node --test tests/*.test.mjs。 */
export default defineConfig({
  test: {
    include: ['tests/ported/**/*.spec.ts'],
  },
})
