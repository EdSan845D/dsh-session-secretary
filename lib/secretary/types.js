/**
 * 秘书能力的外部契约（窄接口 + 事件声明合并）。
 *
 * 本插件用到的四个宿主扩展点里，`approval/request`（dsh-user-approval）、
 * `agent/inbox/claimed` 与 `agent/pre-step`（dsh-agent）、`api-session/error`
 * （dsh-api-session-controller）**官方类型面已声明**，这里**不重复合并** ——
 * 重复声明会与官方签名形成重载，参数变成 union，反而到处报错。
 *
 * 只有 `user-questions/request` 官方没声明（它只出现在 dsh-api-remotes 的远程
 * 事件表里），因此下面只补这一个事件，形状按 DSH 0.2.1-rc.3 桌面版实测定义。
 */
export {};
//# sourceMappingURL=types.js.map