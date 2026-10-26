/**
 * 生命周期通知：完成 / 出错（以及中断转发的投递出口）。
 *
 * - 控制聊天：正文前缀【项目·会话】（labelOf 失败退回无前缀原文，绝不丢通知）；
 * - 系统通道：title + 同一正文（桌面壳下默认关闭，node-notifier 兜底无头部署）；
 * - 任一路径失败只告警，不抛出到事件监听器。
 */
export function createNotifier(deps) {
    async function sendControl(text) {
        const target = deps.control();
        if (target === null)
            return;
        try {
            await target.channel.send(target.chatId, text);
        }
        catch (error) {
            deps.logger.warn(`secretary: 控制聊天投递失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return {
        /** 桥的转发（提问/审批正文自带「会话〈label〉」与 tag），只落控制聊天。 */
        async dispatchForward(signal) {
            await sendControl(signal.body);
        },
        /** 生命周期通知：完成/出错，双通道。 */
        async lifecycle(sessionId, title, body) {
            const label = await deps.labelOf(sessionId).catch(() => '');
            const text = label === '' ? body : `${label}${body}`;
            await sendControl(text);
            if (deps.system !== undefined) {
                try {
                    await deps.system.send({ title, body: text });
                }
                catch (error) {
                    deps.logger.warn(`secretary: 系统通知失败: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        },
    };
}
//# sourceMappingURL=notifier.js.map