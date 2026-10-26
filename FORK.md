# FORK 说明

本仓库是 [MichengAI/dsh-im-connect](https://github.com/MichengAI/dsh-im-connect)（v1.0.18）的 fork，
以 `dsh-session-secretary` v2 身份运行。设计文档见
`Documents\deepseek-harness\dsh-session-secretary\docs\superpowers\specs\2026-10-27-secretary-v2-im-connect-design.md`。

## 与上游的差异（合并时注意 `// [secretary]` 标记）

- 包名/条目 id：`dsh-session-secretary`（loader 身份）；stateDir 默认 `$DSH_HOME/dsh-session-secretary`。
- updater 默认禁用（`Config.updater` / `Config.onlineUpdate` = false；包名与 npm 发布无关，勿开启）。
- locale 显示文案改为「会话秘书」，**i18n 键名未改**（`im-connect.*` 键保持上游原样，减小合并面）。
- HTTP 管理路由前缀 `/api/michengai/dsh-im-connect/*` 保持上游原样（内部路径，全局约束不改）。

## 计划中的增量（实施中）

1. 投递收口【项目·会话】前缀（gateway）
2. 无绑定聊天 AI 意图解析（router + secretary/intent.ts）
3. 秘书 tag 截断（gateway handleInbound 前端）
4. `/ls-project`、`/ls-session` 别名 + `/session <项目> [会话]` 名字解析（chat-commands）
5. 中断/完成/出错通知（secretary/notifier.ts + notify-channels + client 半边，自 dsh-messager fork 移植）
