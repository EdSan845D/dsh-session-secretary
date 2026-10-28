export declare const SECRETARY_PRESET_ID = "session-secretary";
export declare const SECRETARY_PRESET_NAME = "\u4F1A\u8BDD\u79D8\u4E66";
export declare const SECRETARY_PRESET_DESCRIPTION = "\u4F1A\u8BDD\u79D8\u4E66\u4EBA\u8BBE\uFF1AIM \u6865\u63A5\u3001\u4F1A\u8BDD\u901A\u77E5\u3001\u5BA1\u6279\u4EE3\u7B54\u4E0E IM \u63A7\u5236\u53F0\uFF08\u7531 dsh-session-secretary \u63D0\u4F9B\uFF09\u3002";
/** 人设内嵌的命令清单，与 /help 由同一目录生成。 */
export declare function buildSecretaryCommandBlock(): string;
/** 秘书人设系统提示词（预设 persona 行的 prefix）。 {{model}} 由宿主提示词插值填充。 */
export declare function buildSecretaryPersona(): string;
/** 预设组成行；形状与 Loader 条目清单一致（YAML 声明行的 JS 形式）。 */
export interface SecretaryPresetRow {
    id: string;
    name: string;
    group?: true;
    isolate?: Record<string, string | true>;
    disabled?: boolean;
    config?: unknown;
}
export interface SecretaryPresetDefinition {
    id: string;
    name: string;
    description: string;
    order: number;
    plugins: SecretaryPresetRow[];
}
/**
 * 秘书预设的组成行：镜像宿主 shipped standard 预设的工具与分组，仅把 persona 行
 * 替换为秘书人设。原版 tool-bash/tool-pwsh 的 `!!js` 平台条件在 JS 侧直接求值为布尔。
 */
export declare function secretaryPresetRows(): SecretaryPresetRow[];
/** 完整的注册定义；每次调用重新求值（平台条件、人设文案）。 */
export declare function secretaryPresetDefinition(): SecretaryPresetDefinition;
//# sourceMappingURL=preset.d.ts.map