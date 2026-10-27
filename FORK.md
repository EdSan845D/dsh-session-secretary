# FORK 说明

本仓库是 [MichengAI/dsh-im-connect](https://github.com/MichengAI/dsh-im-connect)（v1.0.18）的 fork，
以 `dsh-session-secretary` v2 身份运行。设计文档见
`Documents\deepseek-harness\dsh-session-secretary\docs\superpowers\specs\2026-10-27-secretary-v2-im-connect-design.md`。

## 与上游的差异（合并时注意 `// [secretary]` 标记）

- 包名/条目 id：`dsh-session-secretary`（loader 身份）；stateDir 默认 `$DSH_HOME/dsh-session-secretary`。
- updater 默认禁用（`Config.updater` / `Config.onlineUpdate` = false；包名与 npm 发布无关，勿开启）。
- locale 显示文案改为「会话秘书」，**i18n 键名未改**（`im-connect.*` 键保持上游原样，减小合并面）。
- HTTP 管理路由前缀 `/api/michengai/dsh-im-connect/*` 保持上游原样（内部路径，全局约束不改）。

## 计划中的增量（实施进度）

1. ✅ 投递收口【项目·会话】前缀（gateway deliver/stream 收口，`applySessionLabel` 注入）
2. ✅ 无绑定聊天 AI 意图解析（`secretaryInbound` + 一次性无头代理 + 编号确认，`intentParse` 开关）
3. ✅ 秘书 tag 截断（gateway `handleInbound` 前端，先于原生交互捕获）
4. ✅ `/ls-project`、`/ls-sessions` 别名 + `/session <项目> [会话]` 名字解析（撞名列候选、miss 新建兜底）
5. ✅ 中断/完成/出错通知（`secretary/notifier.ts` + 控制聊天自动学习 + 系统通道，移植自 dsh-messager）
6. ✅ 设置页与配置入口（v2.0 追加，取代「延期到 v2.1」的设置半边）：
   - 设置 → 会话秘书 页内新增「秘书偏好」卡（`SecretaryCard`）：控制聊天状态/清除学习、
     系统通知、四个通知开关、【项目·会话】前缀、AI 意图解析、代笔回复有效期、转发截断长度。
   - 走新端点 `GET/POST /api/michengai/dsh-im-connect/secretary`：偏好落在 `channels.json`
     的 `store.secretary` 覆盖层（沿用 sidebar-entry 先例），读取时与 Config 默认值合并
     （`secretary/runtime-settings.ts`），保存即改即生效，**无需插件重载**。
     `systemEnabled` 覆盖层门控系统通道发送；`Config.system.enabled` 仍是初始默认。
   - 设置 → 插件 → 会话秘书 配置卡新增「打开设置」直达按钮（`openSettingsSection` 深链）。
   - 品牌统一「会话秘书」/ Session Secretary（引擎回复词典键同步更名）。
   - 仍延期到 v2.1：**浏览器通知**（Notification API 半边，需 ModuleLoader 契约侦察）。
7. ✅ 秘书桥两阶段代答移植（v1 已验证语义）+ 四个全局扩展点接线

## 已知环境问题（非本仓库缺陷）

- `tests/discord-proxy`、`tests/telegram-proxy`、`tests/telegram-images` 三个文件在 2026-10-27
  之后的本机环境下**测试用例全部通过但进程不退出**：它们用 `127.0.0.1:7897` 假代理地址，
  当前本机网络/安全软件使该回环连接既不成功也不报错（SYN 悬挂）。全量 `node --test` 会被
  这类悬挂钉住——本地跑套件时将这三个文件排除即可；git bisect（pristine worktree 6209ed8
  同样复现）确认与仓库改动无关。
