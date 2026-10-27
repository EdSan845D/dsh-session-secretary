# 项目长期笔记（dsh-session-secretary v2）

## cordis 4 硬约束

- 未列入插件 `inject` 的服务，**禁止用属性读取**（`ctx.xxx`），cordis 4 会抛
  `cannot get property "xxx" without inject` 并让整个插件 fiber FAILED。只能用
  `ctx.get('xxx', false)`。已知先例：`router.ts` 的 `ctx.sessions`、`index.ts` 的 `ctx.userQuestions`。
- 后果很隐蔽：apply 中途抛错时，本插件的 gateway.log 只留到断点前一行，宿主 UI（设置 → 插件 →
  「包含的组件」）只显示状态异常，不显示原因。

## 运行与调试

- 宿主 profile：`~/.dsh/profiles/desktop`，插件以 `link:` 指向本工作区；宿主加载 `lib/`，
  改完必须 `npm run build`，再**完整重启 DSH + 刷新页面**。
- 最小复现宿主：`new Context()` → `ctx.provide(...)` 注入 webServer/credentials/agents/
  agentPresets/agentDefaultModel/llm/permissionPresets → `ctx.plugin({apply, inject, Config}, config)`。
  直接调 `apply()` 会绕过 fiber 语义，测不出注入类问题。
- 本机已知：`tests/discord-proxy`、`tests/telegram-proxy`、`tests/telegram-images` 三个文件
  用例全过但进程不退出（假代理回环悬挂），与仓库改动无关；跑全量时排除。
