/**
 * 会话标识：【项目·会话】。
 *
 * 投递收口（gateway deliver / 流式收口）在每个出站 IM 文本前缀上拼接该标识，
 * 让一个聊天里的多会话输出可以分辨来源。项目 = 会话 cwd 的目录基名，
 * 会话 = 会话标题（sessionController.list 的 projections.title），缺省回退 sessionId 前 8 位。
 * 列表结果缓存 30 秒；`session/title` 事件路径可调用 invalidate() 强制刷新。
 */
export interface SessionListRow {
    sessionId?: string;
    cwd?: string;
    projections?: {
        values?: {
            title?: string;
        };
    };
}
export interface LabelDeps {
    list(): Promise<{
        items?: SessionListRow[];
    } | null | undefined>;
    now?(): number;
}
/** 目录路径的末段（兼容正反斜杠，去空段）。 */
export declare function basenameOf(path: string | undefined): string;
export declare function createLabelProvider(deps: LabelDeps): {
    labelOf(sessionId: string): Promise<string>;
    invalidate(): void;
};
export type LabelProvider = ReturnType<typeof createLabelProvider>;
//# sourceMappingURL=label.d.ts.map