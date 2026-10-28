/**
 * 会话秘书 Agent 预设：秘书人设 + 运行时注册。
 *
 * 选型说明（相对「按会话注入 systemPrompt 段」的方案）：
 * - 预设经宿主 `agentPresets.register()` 注册（与内置声明行 `@deepseek-ai/dsh-agent-preset`
 *   走同一入口），注册返回注销函数并由声明插件持有——插件禁用/卸载时一并移除，不残留全局配置；
 * - 真预设在 /presets 名册与设置页可见，会话日志如实记录，且从首个 token 就替换
 *   standard 预设的「编码助手」人设（persona 行在预设作用域内遮蔽部署人设）；
 *   systemPrompt 段做不到这两点，只能作为已有人设之上的追加说明。
 * - 宿主服务缺失或注册失败时探测降级：不注册、IM 会话沿用 standard，插件照常激活。
 *
 * 人设中的命令清单与 /help 同源（engine/chat-commands.ts 的 chatCommandSections），
 * 避免提示词硬编码后与实际命令漂移。
 */
import { replyText } from '../engine/command-locale.js';
import { chatCommandSections } from '../engine/chat-commands.js';
export const SECRETARY_PRESET_ID = 'session-secretary';
export const SECRETARY_PRESET_NAME = '会话秘书';
export const SECRETARY_PRESET_DESCRIPTION = '会话秘书人设：IM 桥接、会话通知、审批代答与 IM 控制台（由 dsh-session-secretary 提供）。';
/** 人设内嵌的命令清单，与 /help 由同一目录生成。 */
export function buildSecretaryCommandBlock() {
    return chatCommandSections
        .map(section => [replyText(section.heading), ...section.commands.map(command => `- ${replyText(command)}`)].join('\n'))
        .join('\n\n');
}
/** 秘书人设系统提示词（预设 persona 行的 prefix）。 {{model}} 由宿主提示词插值填充。 */
export function buildSecretaryPersona() {
    return [
        '你是「会话秘书」，常驻在用户本机的 DeepSeek Harness 上、通过即时聊天软件（钉钉、飞书、企业微信、QQ、Telegram、Discord、Slack、微信）与用户协作的秘书，底层由 {{model}} 模型驱动，保留完整的会话工具能力。你的身份是秘书，不是通用编码助手：自我介绍与回答口径都从这一定位出发。',
        '## 你的能力（由 dsh-session-secretary 插件提供）\n'
            + '- 消息桥接：用户从聊天软件发来的普通文字就是你收到的任务，按普通会话执行，并把结果整理成适合手机阅读的短回复。\n'
            + '- 主动通知：会话回合完成、出错、等待审批、等待回答时，插件会把通知直接推送给用户；这些通知由插件本地生成，不经过你。\n'
            + '- 审批与提问代答：其他 DSH 会话的工具审批与补充提问会转发到聊天里，用户回复「批准/拒绝」或直接作答，由插件代为回传。\n'
            + '- IM 控制台：以 / 开头的消息由插件本地处理并直接应答，不会发送给你，也不要试图执行它们。',
        '## 行为约定\n'
            + '- 用户问「你有哪些指令 / 你能做什么 / 怎么用」时，以会话秘书的身份介绍上述能力与下面的命令清单；不要回答通用 DSH 指令，也不要编造清单之外的命令。\n'
            + '- 回复短小、口语化，一次讲一件事；少用重排版，列表与代码块只在必要时使用。\n'
            + '- 会话、任务与配置的状态属于事实问题，引导用户用命令查询（如 /status、/model、/delivery），不要凭印象断言。\n'
            + '- 命令清单可能随插件更新变化；需要权威清单时让用户发送 /help。',
        `## 命令清单\n\n${buildSecretaryCommandBlock()}`,
    ].join('\n\n');
}
// 与宿主 dsh-web-app 捆绑包 presets/standard.patch.yml（0.2.x）同构的 plan-mode 提示词。
// 预设组成无法引用另一预设的定义，只能整表声明；宿主 standard 更新时此处需同步。
const PLAN_MODE_SECTION = [
    'You are in plan mode. Stay in plan mode until the user approves your plan through exit_plan_mode or switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user\'s conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.',
    '',
    'Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.',
    '',
    'The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.',
    '',
    'Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.',
    '',
    'Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.',
    '',
    'When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.',
].join('\n');
/**
 * 秘书预设的组成行：镜像宿主 shipped standard 预设的工具与分组，仅把 persona 行
 * 替换为秘书人设。原版 tool-bash/tool-pwsh 的 `!!js` 平台条件在 JS 侧直接求值为布尔。
 */
export function secretaryPresetRows() {
    return [
        { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: buildSecretaryPersona() } },
        { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
        { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
        { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: process.platform === 'win32' },
        { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: process.platform !== 'win32' },
        { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
        { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
        { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
        { id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule' },
        { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
        { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
        { id: 'command-goal', name: '@deepseek-ai/dsh-command-goal' },
        { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },
        {
            id: 'planning',
            name: 'cordis:group',
            group: true,
            isolate: { planMode: true },
            config: [{ id: 'plan-mode', name: '@deepseek-ai/dsh-plan-mode', config: { section: PLAN_MODE_SECTION } }],
        },
        {
            id: 'compaction',
            name: 'cordis:group',
            group: true,
            isolate: { compaction: true, toolResultPruner: true },
            config: [
                { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
                { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
                { id: 'tool-result-pruner', name: '@deepseek-ai/dsh-compaction-tool-result-pruner', config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 } },
            ],
        },
        {
            id: 'delegation',
            name: 'cordis:group',
            group: true,
            isolate: { workflowEngine: true },
            config: [
                { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
                { id: 'tool-subagent-list-agents', name: '@deepseek-ai/dsh-tool-subagent-control/list-agents' },
                { id: 'tool-subagent', name: '@deepseek-ai/dsh-tool-subagent', config: { provider: 'spawn', toolName: 'subagent', modelSelectionSettings: true } },
                { id: 'tool-subagent-fork', name: '@deepseek-ai/dsh-tool-subagent', config: { provider: 'fork', toolName: 'subagent_fork' } },
                { id: 'workflow-ptc', name: '@deepseek-ai/dsh-workflow-ptc', config: { provider: 'spawn' } },
                { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
            ],
        },
        { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
        { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
        { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true, searchTimeoutMs: 60000 } },
        { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
        { id: 'tool-plugin-manager', name: '@deepseek-ai/dsh-plugin-manager/tools', disabled: true },
        { id: 'tool-plugin-market', name: '@deepseek-ai/dsh-plugin-market/tools', disabled: true },
    ];
}
/** 完整的注册定义；每次调用重新求值（平台条件、人设文案）。 */
export function secretaryPresetDefinition() {
    return {
        id: SECRETARY_PRESET_ID,
        name: SECRETARY_PRESET_NAME,
        description: SECRETARY_PRESET_DESCRIPTION,
        order: 2,
        plugins: secretaryPresetRows(),
    };
}
//# sourceMappingURL=preset.js.map