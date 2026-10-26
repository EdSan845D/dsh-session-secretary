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
6. ⏳ **client 通知半边（浏览器通知 + 设置页分区）延期到 v2.1**——原因：dsh-im-connect 的 client 是
   ModuleLoader 工厂（require 白名单、内联构建、符号检查），与 dsh-messager 的 cordis client 模块
   （8 包 inject + tsdown 构建）架构不同，完整移植需先吃透 ModuleLoader 对 DSH client 服务的暴露契约。
   v2.0 桌面 toast 由宿主侧 system 通道（node-notifier，默认开启）承担；secretary 开关配置走
   DSH 设置 → 插件 → 会话秘书 的通用配置编辑器。
7. ✅ 秘书桥两阶段代答移植（v1 已验证语义）+ 四个全局扩展点接线
