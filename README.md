<p align="center">
  <img src="assets/branding/dsh-banner.png" alt="DSH Session Secretary" width="100%">
</p>

<div align="center">

  # DSH Session Secretary 会话秘书

  **A session-management secretary for DeepSeek Harness — it reaches you through IM when a session needs you, and lets you manage every session from chat**

  [简体中文](README.zh-CN.md) · [Changelog](CHANGELOG.md) · [Apache-2.0](LICENSE)

  [![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
  [![DSH Web Plugin](https://img.shields.io/badge/DSH%20Web-Plugin-0f766e.svg)](https://github.com/MichengAI/dsh-im-connect)
  [![Node.js 22 or later](https://img.shields.io/badge/Node.js-22%20or%20later-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
  [![Channels](https://img.shields.io/badge/channels-9-238636.svg)](#-supported-channels)
  [![fork of](https://img.shields.io/badge/fork%20of-MichengAI%2Fdsh--im--connect-8250df.svg)](https://github.com/MichengAI/dsh-im-connect)
</div>

> This project started as a fork of [DSH IM Connect](https://github.com/MichengAI/dsh-im-connect) but follows its own goal: acting as a **secretary for your sessions** rather than only an IM bridge. It still tracks upstream and merges its updates regularly.

## What this project is

You run several DeepSeek Harness (DSH) sessions at once — long tasks, background agents, plans waiting for approval. You cannot watch all of them. The session secretary can:

1. **Watch your sessions and reach you** — when a session asks a question, needs a tool approval, finishes a turn, or hits an error, the secretary sends a notification to your desktop and/or your instant messenger, with a readable summary of what happened.
2. **Talk back through IM** — reply in the messenger to answer the question, approve the tool, or steer the task. Two-phase proxy replies keep numbered confirmations safe: the secretary asks, you confirm, it acts.
3. **Manage sessions from chat** — bind any session to a chat, switch between them, start new ones, and command them (`/menu`, `/stop`, `/model`, …). Plain text in an unbound chat is parsed by AI into an intent (open / create / clarify) with a numbered confirmation before anything happens.

The IM channel is the secretary's voice, not the point. The point is that every session can reach the right person at the right moment, through the messenger you already have open on your phone.

## Features

- **Session notifications (secretary core)**: forward questions and approval requests from any session to a control chat; send completion and error notices for sessions that are not bound to a chat; optional desktop toasts via the system notification channel (Windows notification center).
- **Control chat with learning**: pin a chat in the config, or just DM the bot once on any connected channel — the secretary learns it automatically and lands every notification and confirmation there.
- **AI intent parsing**: in a chat that is not bound to any session, plain text is interpreted by a headless agent into "open session N / create a session / clarify", shown back as `[1] confirm [2] cancel` before anything runs.
- **Source labels**: IM replies carry a `【Project · Session】` prefix so a group chat fed by several sessions stays readable.
- **IM console (inherited from upstream, kept current)**: 9 messaging platforms, per-account workspaces/models/permissions, slash commands, action menus, interactive approvals, segmented replies, task-tree filtering, delivery recovery — see the reference sections below.
- **Everything stays local**: settings, learned control chat, and credentials live in the plugin's state directory on your machine; notifications only leave through the channels you configured.

## Who can drive the assistant

Inbound messages are identified before commands, tool approvals, or injection.

| Case | Behavior |
|---|---|
| Group without a mention of this bot | Ignored without a reply or pending approval request; mentioning someone else also does not trigger it |
| Group explicitly mentioning this bot | No binding. Anyone can send work |
| DM from the QR scanner | WeChat / Feishu / Lark / QQ scanners are allowlisted automatically |
| DM from anyone else | Appears on the settings pending list until approved |
| DM after QR binding that does not return user identity | DingTalk / WeCom QR setup returns bot credentials only, so the scanner still needs settings approval |
| DM after manual credentials | Telegram, Discord, Slack, and DingTalk / WeCom / QQ bound manually, require approval for every DM |
| DM without a userId | Denied |
| Tool approval | Reply `Approve` / `Deny` (or `批准` / `拒绝`) in the chat bound to that session; works in DMs and groups, and never falls back to the web. No reply within 5 minutes cancels the action, and other text is not queued behind it |
| Interactive choice | Reply with an option number or text in the originating IM conversation; separate multiple choices with commas or add a custom answer; only the initiating user can answer in a group |

WeChat is QR-only and DM-only, so the same WeChat account that scanned can talk immediately. A different WeChat account DMing the bot waits for settings approval.

## 📡 Supported channels

<p align="center">
  <code>🔔 DingTalk</code>&nbsp;
  <code>🐦 Feishu</code>&nbsp;
  <code>🌐 Lark</code>&nbsp;
  <code>💬 WeChat</code>&nbsp;
  <code>🏢 WeCom</code>&nbsp;
  <code>🐧 QQ</code>&nbsp;
  <code>✈️ Telegram</code>&nbsp;
  <code>🎮 Discord</code>&nbsp;
  <code>🧩 Slack</code>
</p>

| Channel | Status | How to connect | You need |
|---|---|---|---|
| 🔔 **DingTalk** | ✅ Ready | QR, or Client ID / Secret | DingTalk open-platform bot; replies prefer AI Card |
| 🐦 **Feishu** | ✅ Ready | QR, or App ID / App Secret; QR creates the bot automatically | Feishu account, or a self-built bot with App ID / Secret |
| 🌐 **Lark** | ✅ Ready | QR, or App ID / App Secret | Lark account, or a self-built bot with App ID / Secret |
| 💬 **WeChat** | ✅ Ready* | Official iLink QR | Dedicated account recommended; DM only |
| 🏢 **WeCom** | ✅ Ready | QR (recommended), or Bot ID / Secret | WeCom intelligent bot |
| 🐧 **QQ** | ✅ Ready | QR, or AppID / AppSecret | QQ Open Platform bot, not a personal QQ account |
| ✈️ **Telegram** | ✅ Ready | Bot Token only | `@BotFather`; do not enable Webhook on the same bot |
| 🎮 **Discord** | ✅ Ready | Bot Token only | Official Developer Portal bot. Enable the Message Content Intent. The first mention in a text or announcement channel continues in a thread without another mention |
| 🧩 **Slack** | ✅ Ready | Bot Token and App Token | Create an app at api.slack.com and enable Socket Mode. DMs reply directly; channel mentions reply inside that message's thread, and later replies in the thread need no new mention |

✅ Ready = text in and out works ｜ *WeChat = official iLink only, no reverse-engineered personal protocol ｜ Groups still require an @ mention. Discord skips repeat mentions only inside a thread the bot created; Slack skips them inside a thread the bot already joined

## Secretary preferences

Everything on the secretary side is managed in **Settings → 会话秘书** (the plugin's settings page) and takes effect immediately — no restart:

| Preference | Default | What it does |
|---|---|---|
| 提问转发 / Forward questions | on | A session's `user-questions` request is forwarded to the control chat as an answerable message |
| 审批转发 / Forward approvals | on | Tool-call and plan approvals are forwarded to the control chat |
| 完成通知 / Completion notices | on | When a turn finishes normally and the session is not bound to an IM chat, a ✅ summary is sent |
| 出错通知 / Error notices | on | When a session errors and is not bound to a chat, a ❌ notice is sent |
| 【项目·会话】前缀 / Source labels | on | IM replies are prefixed with their project and session label |
| AI 意图解析 / AI intent parsing | on | Plain text in unbound DMs is parsed into open/create/clarify with numbered confirmation |
| 控制聊天 / Control chat | learned | Shown as pinned / learned / not-learned; **清除学习** forgets the learned chat |
| 代笔回复有效期 / Reply window | 1440 min | Numbered confirmations and proxy replies expire after this window |
| 转发截断长度 / Forward truncation | 1200 chars | Maximum length of a single forwarded message |
| 系统通知 / System toasts | on | Desktop toast channel (node-notifier / SnoreToast); verbosity minimal/normal/detailed |

The control chat can also be pinned by config (`secretary.controlChatId`); learning only fills the gap. All of these persist as an overlay in `channels.json` (`store.secretary`), with the plugin config as defaults, so changes from the settings page apply live.

## Image input

Image input follows DSH Chat's model-capability and attachment rules rather than guessing vision support from model names:

The receive paths cover WeChat, WeCom, DingTalk, Feishu, Lark, QQ, Telegram, Discord, and Slack. See the [image-input verification guide](docs/image-input.md) for protocol forms and live checks.

- Use the model currently selected for the IM session, not just the global default.
- When the model declares `image` support, store images as standard DSH attachments and submit image content to the model. Session history keeps image references rather than only local-path text.
- When the model explicitly excludes image input, tell the sender to switch models instead of silently dropping the image. Missing capability metadata follows Chat's compatibility behavior and is not, by itself, a reason to reject an image.
- Channel download limits, host attachment size and format limits, DM access rules, and group mention requirements still apply.
- This is inbound image analysis, not a promise that every channel supports sending images from the bot or generating images.

## File input

WeChat, WeCom, DingTalk, Feishu, Lark, QQ, Telegram, Discord, and Slack accept ordinary files through Chat’s upload service for the current session. Send PDFs, documents or spreadsheets for the assistant to process. Format support follows web Chat’s models, tools and file capabilities; uploading does not guarantee that every format can be understood directly.

- Requires the file-upload service on supported hosts (`>=0.2.0-rc.1 <0.3.0-0`). Legacy versions and breaking changes in the `0.3.0` generation are rejected by the version gate. If you still use a `0.1.x` host, install plugin `0.1.78` instead of `@latest`.
- Up to 4 ordinary files per message, totaling 20 MiB. Channel download limits also apply.
- Files become standard Chat attachments and are submitted with session-specific receipts, rather than local-path text.
- Private admission and group mention rules remain in force. File captions such as `/new` or “allow” are content, not commands or approval responses.
- Failed uploads do not submit partial text. Disabling or reloading an account prevents later submission to the old session. Generated files can be sent back after the reply.

## File delivery

WeChat, WeCom, DingTalk, Feishu, Lark, QQ, Telegram, Discord, and Slack can return files produced by the assistant. For example: “Create a PDF report and send me the file.”

- Files successfully created or edited with Chat's supported file tools are sent after the reply. On hosts with `present`, explicitly presented files are also sent, including existing files.
- File access follows Chat: files outside the workspace are allowed when the host can read them. The plugin does not extract arbitrary paths from reply text. Files created through shell commands need to be presented explicitly.
- Supported hosts use Chat's complete-file download service and its configured size limit. Directories and symbolic links are not sent; channel-specific file limits still apply.
- A failed transfer produces a message naming the file and does not stop the remaining files. Switching away from the session or stopping the account prevents pending delivery from continuing to a different target.
- Send `/export` as a standalone command to receive the current linked session’s Chat ZIP logs in this chat, without child sessions. The ZIP limit is 32 MiB; channel limits also apply. If the file is too large or cannot be sent, use `/export` in web Chat. Paths and other session IDs are not accepted.

## Action menu

After a valid selection, supported cards remove their buttons and mark the selection; the following reply reports the actual result. WeCom updates are limited to the button callback window; expired actions are still rejected by the server. `/status` offers actions based on the current state, such as stopping a task, pausing or resuming a goal, and viewing queued messages.

On channels with native buttons, `/sessions`, `/workspaces` and `/models` open a selector directly. After paging, numbered replies and `/session N`, `/workspace N` or `/model N` refer to the current selection page. Text channels keep their original list numbering.

Send `/menu` or `/m` to select sessions, workspaces, models and Agent presets, or start, stop, export and inspect a session. Lists support pagination. Click a button or reply with the current menu number; ordinary text exits the menu.

Menus include previous, next and back actions. WeCom menus paginate to fit card limits, including the main menu (`/menu 2`). Open a selector directly with `/menu sessions`, `/menu workspaces` or `/menu models`; presets and reasoning use `/menu presets` and `/menu reasoning`.

Common command replies offer related next steps: for example, `/model` → select a model / adjust reasoning → back to menu. Supported channels offer buttons; text replies include the commands to send. Navigation buttons on ordinary result replies do not accept numeric shortcuts, so numbers remain chat input; only selection menus accept numbered replies. Oversized cards fall back to complete text.

DingTalk, Telegram, Discord, Slack, and Feishu/Lark use native buttons. WeCom uses cards when button count and text length fit platform limits. Other cases, QQ and WeChat use numbered text. Explicit rejections and capacity limits fall back to complete text. Uncertain network delivery produces a confirmation notice instead of resending the card. Menus are scoped to the account, chat, operator and session, expire after 15 minutes or restart, and recheck permissions on selection. Used buttons cannot execute again.

Approvals and questions use the same native-button channels: allow once/reject, single-choice selection, and multiple selections followed by submit. Open questions retain text input. Approvals always stay in the chat that started the task and never fall back to the web; a failed prompt is treated as a denial. If nobody approves or rejects within 5 minutes, the action is canceled and the chat is told it did not run. Other text during that wait is reminded to finish the approval and is not submitted as the next turn. Images and files are still submitted as content and are not treated as the approval reply. In groups only the task initiator can approve; DMs add no extra restriction beyond chatting. Disabling commands does not disable pending approvals or questions. Questions have no such timeout; the next text message is still the answer.

Agent presets: `/presets` (alias `/presetlist`) lists presets; `/preset` shows the current preset. `/preset number-or-ID` starts and switches to a new session in the current workspace, keeping previous sessions. Use `/preset id:ID` for numeric IDs and `/preset --default` for the default preset. Account defaults remain unchanged; later `/new` commands still use account settings. Native buttons support direct selection; text lists use numbers valid for 15 minutes.

Reasoning: `/reasoning` (aliases `/reasonings`, `/reasoninglist`) lists levels for the current model. Use `/reasoning number` or `/reasoning id:effort-ID`, or `/reasoning --default` to reset. Native channels offer paginated buttons. List selections are bound to the session and model; refresh the list after switching. Model and reasoning updates follow Chat’s default-selection persistence rules.

Work started by an IM message gets one result notice after response and file delivery finishes, with links to recent messages, status, session export and the menu. Failures, stops and delivery failures are distinguished; tasks and files are not retried automatically. When commands are disabled, notices are text-only. Ordinary numbers remain chat input. Approvals and questions keep their existing prompts. Completion navigation is suppressed after switching sessions, disabling the account or starting a later turn.

## Message progress

Regular chat messages follow the actual task state. Commands continue to use text replies.

- DingTalk: labels on the original message show queued, thinking, waiting for confirmation, done, failed, or cancelled.
- Feishu / Lark: reactions indicate processing, done, or failed. Waiting keeps the processing reaction; cancellation removes it.
- Telegram: 👀 processing, 🤔 waiting for confirmation, 👍 done, and 👎 failed. Cancellation removes the reaction. Typing is refreshed while processing.
- Discord: uses the same reactions and edits one message as the answer streams. Typing is refreshed while processing. Cancellation removes the reaction.
- Slack: ✅ done, ❌ failed, 🤔 waiting, and 👀 processing are added as emoji reactions on the original message (requires `reactions:write`). Answers stream by editing one message; Slack has no bot typing indicator.
- WeChat: typing is refreshed while processing and stopped when finished or waiting for confirmation. WeCom and QQ retain their existing reply behavior.

WeChat suppresses transition text in assistant messages that also contain `tool-call` blocks to reduce reply-window usage. Text-only replies, approvals, questions, and result files are unaffected by this filter. Suppressed text does not count as a successful delivery, and history-based redelivery uses the same rule. This does not remove platform limits: long reply fragments and necessary interactions may still exhaust the window. Ambiguous or partial deliveries are not blindly resent in full.

Done means the turn completed normally and both text and files were delivered. Stopped or failed tasks and later queued messages are not marked done. Channel permissions and network conditions may prevent status updates without blocking chat. Text labels follow the web language setting.

## Connection diagnostics

Use **Diagnose connection** in account settings to query platform APIs: WeChat configuration, a ping acknowledgement on the existing WeCom connection, DingTalk credentials, Feishu/Lark credentials and bot identity, QQ credentials and gateway, Telegram bot identity and Webhook conflicts, Discord bot identity and Gateway URL, or Slack bot identity plus Socket Mode state when a connection already exists (no new connection is opened).

Each check reports passed, failed, or unverified, with timing and a suggested next step. No test messages are sent and no extra message polling is started. Passing one check does not verify all messaging permissions. An older backend prompts you to restart DSH and refresh the page.

## Screenshots

Add accounts under each channel in **Settings → 会话秘书**. Expand a channel and click an account name to add a remark so you can tell users apart. The settings button configures workspace, model, permission, private access, and send mode. The **Receive messages** switch is on the account row:

![Session Secretary settings](assets/screenshots/settings-channels.png)

The workspace splits **Tasks** and **Channels**. IM sessions appear only under **Channels** (and, optionally, in the task tree — see the toggle below):

![Workspace channel sidebar](assets/screenshots/workspace-channels.png)

WeCom and other QR channels support scan-to-bind:

![WeCom QR binding](assets/screenshots/wecom-qr.png)

After connecting, the secretary reaches you wherever you are:

<p align="center">
  <img src="assets/screenshots/wecom-chat.jpg" width="220" alt="WeCom chat">
  <img src="assets/screenshots/weixin-chat.jpg" width="220" alt="WeChat chat">
  <img src="assets/screenshots/dingtalk-chat.jpg" width="220" alt="DingTalk chat">
</p>
<p align="center">
  <img src="assets/screenshots/feishu-chat.jpg" width="220" alt="Feishu chat">
  <img src="assets/screenshots/qq-chat.jpg" width="220" alt="QQ chat">
  <img src="assets/screenshots/telegram-chat.jpg" width="220" alt="Telegram chat">
</p>

## Prerequisites

- A working DeepSeek Harness Web installation with `dsh` available in PowerShell.
- Host compatibility: DeepSeek Harness `0.2.x` line (`>=0.2.0-rc.1 <0.3.0-0`). Legacy versions and breaking changes in the `0.3.0` generation are rejected by the version gate.
- Source installation and development require Node.js 22+.
- After install, restart `dsh web` and hard-refresh the browser before opening **Settings → 会话秘书**.

## Installation

This fork is not published to npm. Install it from source (the upstream npm package `@michengai/dsh-im-connect` belongs to the original project and will overwrite this plugin's behavior):

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
# Replace this with an existing projects directory.
Set-Location "$HOME\Projects"
git clone <this-fork-url> dsh-session-secretary
Set-Location .\dsh-session-secretary
npm install
npm test
dsh plugin --profile web add .
dsh --profile web --dump-config
```

The configuration output should contain `dsh-session-secretary`. Restart DSH Web and hard-refresh the browser. Do not copy client files manually: `dsh plugin ... add .` reads the package metadata and `cordis.patch.yml`.

## Plugin Configuration & Toggles

Options are located at **Sidebar → Plugins → `dsh-session-secretary`** (the host's `plugins.bundle.config` slot) and in **Settings → 会话秘书**. Switch values persist in `channels.json` under the plugin's `stateDir` and survive restarts.

### 1. Sidebar Entry (`sidebarEntry`)
- **Default**: Disabled (`false`)
- **Description**: Displays a persistent **会话秘书** navigation icon in the host's left primary sidebar.
- **Effect**:
  - When enabled, clicking the sidebar icon opens the management page directly in the primary workspace with a **960px centered container** (matching host plugin manager conventions);
  - When disabled, unregisters the sidebar entry cleanly (and resets active panel gracefully if currently viewing the panel);
  - The standard **Settings → 会话秘书** view remains active either way, and state is synchronized live across both entry points. The bundle card also carries an **打开设置** button that jumps straight to the secretary page.

### 2. Online Updates (`onlineUpdate` / `updater`)
- **Default in this fork**: Disabled (`false`) — deliberate. The fork tracks upstream via git merges instead of self-installing the upstream npm package, so the update pipeline is off unless you turn it on.
- **Effect when enabled**: the header shows **Check for updates**; when disabled the button is hidden and the update API route returns `HTTP 403`. A host lock can still pin it via Cordis configuration:
  ```yaml
  updater: false # or onlineUpdate: false
  ```
  The host lock takes precedence over the user's choice in `channels.json` and cannot be lifted through the UI.

### 3. Show IM Sessions in Task Tree (`taskTreeSessions`)
- **Default**: Disabled (`false`, hides IM sessions in the workspace task tree by default to keep daily workspaces clean)
- **Description**: Controls whether messaging channel sessions appear in the official workspace task tree.
- **Effect**:
  - **Workspace Decluttering**: When disabled, all messaging sessions (including `dsh-im-session-*`, legacy `im:*` prefixes, and active channel session bindings) are automatically filtered out from the official workspace task tree;
  - **Channels Tab Preserved**: Filtering applies only to the official workspace tree. All channel sessions remain fully available under the sidebar's **Channels** tab;
  - **Lightweight Pipeline Collaboration**: Implemented via the `NativeTabRegistry.sessionFilters` inter-plugin protocol without invasive host hijacking. Toggling takes effect immediately and interoperates smoothly with Automation and Archive Manager.

### 4. Secretary preferences (`secretary.*` / `system.*` / `browser.*`)
- Managed on the settings page (see [Secretary preferences](#secretary-preferences)); the plugin config only carries defaults, so these groups are hidden from the generic config editor.
- `secretary.controlChatId` can be set in the config file to pin a control chat; the learning mechanism fills it in otherwise.

## Usage

Open **Settings → 会话秘书**, select **Add account** under the target channel, then choose that account's workspace, model, permission, private-access mode, and send mode. To register a new workspace, click **Add workspace…** in the dropdown footer to invoke the system folder picker (manual path inputs are disallowed).

| Goal | Action | Notes |
| --- | --- | --- |
| Add an account | Select **Add account** under a channel, choose the account settings, then scan or enter credentials | The same channel can contain multiple accounts; WeChat is QR-only, Feishu / Lark accept QR or App ID / App Secret, Telegram and Discord need a Bot Token, and Slack needs a Bot Token plus an App Token |
| Learn the control chat | DM the bot once from any connected channel | The secretary records that chat for all notifications and confirmations; manage it on the settings page |
| Get notified | Leave sessions running anywhere in the host | Questions, approvals, completions, and errors reach the control chat and/or desktop toasts, even for sessions the plugin did not create |
| Open a session from IM | Send plain text in an unbound DM (intent parsing on) | The AI proposes open/create/clarify; reply with a number to confirm or「取消」to abort |
| Send work from IM | Bind a session first (`/session`, or accept the intent proposal), then just talk | Each chat has its own channel session |
| Split input | End with `..` to continue, `!!` to flush now | Default merge window is about 5 seconds |
| Start a new session | Send `/new` or `/clear` | Creates and switches the current IM session; previous sessions stay in the Channels list |
| Status / help | Send `/status` or `/help` | Current session and dynamically discovered Chat commands |
| Command permissions | Open Settings on the account row and toggle DM/group commands | Admission is checked first; disabling commands keeps conversation and approval/question replies available |
| Sessions / workspaces | `/sessions`, `/session <number or ID>`; `/workspaces`, `/workspace <number or ID>` | Resume ordinary Chat sessions; workspace selection creates a session without changing account defaults |
| Task controls | `/stop`, `/steer <text>`, `/queue` | Stop, provide instructions, or inspect the queue |
| Send mode | Open Settings on the account row and choose Queue or Steer under **Send mode** | Queue (the default) keeps today's behavior; Steer hands an ordinary message to the running task as additional instructions immediately |
| Segmented replies | Open Settings on the account row, choose Send in segments under **Segmented replies**, and fill in the send-gap range | Defaults to Send as whole; the secretary puts the source label on the first segment only. See [Segmented replies](#segmented-replies) |
| Result recovery | `/delivery`, `/delivery retry <record-ID>` | Check recent deliveries and resend text from the original task |
| Session management | `/history`, `/rename <title>`, `/fork` | Recent text history, rename, or fork and switch |
| Approve a stranger DM | Open **Settings → 会话秘书** and approve or deny the pending request | Affects DM access only |
| Answer an interactive question | Reply with an option number or text; separate multiple choices with commas, or enter a custom answer | Multiple questions arrive in order; only the initiating user can answer in a group |
| Approve a tool | Reply `Approve` / `Deny` or `批准` / `拒绝` in a DM | Also accepts `yes` / `no` / `allow` / `reject`; group replies cannot grant |
| Review on the web | Open the workspace **Channels** tab | IM sessions never appear under **Tasks** |

Switching sessions stops output pushes from previous sessions to this chat. History remains available on the web. `/unbind` lists this chat's registered sessions; `/unbind <number or ID>` removes an old registration, and `/unbind all` keeps only the current session. `/mute <number or ID>` pauses assistant output without removing the registration; `/unmute` with the same target resumes future output.

DingTalk replies prefer official AI Card streaming. QQ replies use official markdown. Telegram replies are sent as Rich Messages with Markdown. Feishu normal replies also use card Markdown. Long replies split with structure awareness: table chunks repeat the header, code fences are re-closed, and the `(n/m)` marker only prefixes prose chunks. Discord renders headings, bold text, code, and lists on the client but has no Markdown tables, so pipe tables become a vertical block per row. Slack converts outgoing text to mrkdwn. Everything else is sent verbatim.

### Telegram topic naming

Telegram topics are automatically named once from the first non-fallback session title; later conversation titles do not keep changing the topic name. `/rename <title>` explicitly synchronizes the topic name.

- `/topicname` shows this topic's policy and lock state. `/topicname off` locks automatic naming; `/topicname on` unlocks it.
- The plugin configuration `topicNaming` accepts `once` (default), `follow` (follow valid titles), or `off` (disable automatic naming).
- Naming and lock state persist across restarts in `topic-titles.json` under the state directory.

### Segmented replies

When **Segmented replies** is set to Send in segments for an account, the assistant splits one reply at a separator and sends the pieces one by one, which reads like a few messages in a row. It defaults to Send as whole and behavior is unchanged while off. It is currently enabled for QQ only (verified end to end); other channels do not show the option and never split.

- **Send gap**: fill in the minimum and maximum gap (seconds, 0–60). Every message, including the first, waits a random gap drawn from that range; saving is rejected when the maximum is lower than the minimum, and changes apply immediately.
- **Separator**: set by the plugin configuration `segmentMarker`, default `<<<MSG>>>`, and must occupy its own line. The same text inside a fenced code block never splits a reply, so code samples stay intact.
- **Where it is stored**: the toggle and range live per account in `channels.json`; the plugin configuration `segmentReply` acts as the default for every account, with the account setting taking precedence. If one segment fails to send, the rest stop instead of resending the whole reply, so no duplicate messages. The `【Project · Session】` source label is applied to the first segment only — one reply, even split, is one utterance from that session.

### Connecting Slack

Slack uses a Socket Mode long connection, so no public URL or request URL is required:

1. Open <https://api.slack.com/apps> and choose **Create New App → From scratch**, then pick your workspace.
2. Under **OAuth & Permissions → Bot Token Scopes**, add at least: `chat:write` (replies), `reactions:write` (status reactions), `files:read` (receive files), `files:write` (return files), `im:history` (DMs), `channels:history` (public channels), `groups:history` (private channels), and `app_mentions:read` (@ mentions). Do not paste a user token (`xoxp-`). Multi-person DMs (mpim) are not supported.
3. Click **Install to Workspace** at the top of the page and copy the **Bot User OAuth Token** (`xoxb-…`).
4. Open **Socket Mode**, enable it, click **Generate Token and Scopes**, tick `connections:write`, and copy the **App-Level Token** (`xapp-…`, shown once).
5. Open **Event Subscriptions**, enable events, and under **Subscribe to bot events** add `message.im`, `message.channels`, `message.groups`, and `app_mention`.
6. In **Settings → 会话秘书 → Slack → Add account**, paste both tokens.
7. Invite the bot to the channels you need with `/invite @your-bot`. Channels only respond after an @ mention; DMs work immediately.

Notes:

- **Where replies land**: DMs answer directly. Public and private channels answer inside the thread of the message. The 512 most recently joined threads are saved per account on this machine, so follow-ups still need no mention after a restart.
- **Commands**: Slack clients treat a halfwidth `/` as a slash command, so `/menu` must be registered in the app. Without that registration, send `!menu` or `!help`, or a fullwidth `／help`. An unknown `!hello` stays an ordinary message. DM commands still use the allowlist. A `!` command in a channel does not need a mention and is answered in a thread. Native buttons also work.
- **Diagnostics**: **Diagnose connection** calls `auth.test` for bot identity and reports Socket Mode state only when a connection already exists.
- **After changing scopes**, reinstall the app and reconnect the bot; an old Bot Token does not gain new scopes automatically.

Send commands as separate text messages; image captions remain ordinary input. Start with `/help`; individual replies also suggest related actions.

- Sessions and workspaces: list numbers expire after 15 minutes. Archived sessions are marked; restore them on the web first.
- Models: as in Chat, `/model` and `/reasoning` also attempt to save the default for future sessions. Other existing sessions are not changed.
- Stopping and queues: `/stop` submits a stop request and keeps queued messages. Pause an active goal separately with `/goal pause`. Use `/queue` to view and manage queued messages.
- Forking: `/fork` requires at least one completed turn.
- Permissions and export: `/permission` settings survive session restoration. `/export` follows private-chat admission and private/group command permissions.

Command replies, tool approvals, interactive questions, and channel notices sent directly to the user follow the language saved in the host's global settings. With no saved preference or an unavailable language service, they default to Chinese.

## Permissions and security boundaries

Command permission does not grant DM admission or replace tool approval. Enabled users can inspect and resume ordinary Chat sessions and execute registered Host commands.

| Item | Current behavior |
| --- | --- |
| Access | Groups need no binding, only a mention. Each account can allow only approved users or all DM users; approved-only is the default, and WeChat / Feishu / Lark / QQ QR scanners are added to that account's allowlist automatically |
| Management API | Uses `/api/dsh-im-connect`, following the REST prefix used by other DSH plugins. It delegates Host, Origin, and Cookie checks to Host `connection.requestRejection`, including local requests. Unavailable authentication returns 503; mutations retain JSON, client-header, and 1 MiB limits |
| Secretary notifications | Completion/error/question/approval notices go only to the learned or pinned control chat and the local system toast channel. They never include secrets; forwarded content is truncated by the configured limit |
| Secrets | WeChat tokens and other secrets prefer DSH `ctx.credentials`; otherwise they use plaintext `%DSH_HOME%\dsh-session-secretary\secrets.json`, restricted to the current user and never safe to sync or share |
| Account state | `channels.json` stores per-account workspace, model, permission, private access, send mode, segmented-reply toggle and gaps, secretary preference overlay, enablement, and credential refs, not raw secrets |
| Browser payloads | Never include tokens, secrets, App Secrets, or internal error details |
| WeChat protocol | Official iLink only; no reverse-engineered personal WeChat protocol |
| Tool approval | The task initiator replies in the chat bound to that session. Approvals never go back to the web. No reply within 5 minutes cancels the action instead of queueing later text |
| Interactive questions | Single-choice, multiple-choice, and custom questions return to the originating IM conversation; one conversation handles them in order, and only the initiating user can answer in a group |

Keep the DSH backend listening on loopback. Remote access should use a controlled HTTPS reverse proxy, the actual authority in the Host's `trustedHosts`, and a login through that authority. Permission presets use the same host sandbox-policy values as Chat; `danger-full-access` does not wrap a sandbox.

## Development

### Project layout

This repository develops in `src` and builds to `lib`:

- [src\index.ts](src/index.ts): host entry, config schema, and lifecycle; wires the secretary (`wireSecretary`) and the upstream segment-reply system-prompt section.
- [src\secretary](src/secretary): the secretary itself — control-chat learning, label provider, two-phase proxy bridge, notifier, and AI intent parsing.
- [src\notify-channels](src/notify-channels): system toast channel (node-notifier / SnoreToast).
- [src\manager.ts](src/manager.ts): channel start/stop, authenticated management API (including `/secretary` preferences), and credential persistence.
- [src\engine](src/engine): session routing, slash commands, approval, splitting, segmented replies, and outbound push.
- [src\channels](src/channels): DingTalk, Feishu, Lark, WeChat, WeCom, QQ, Telegram, Discord, and Slack adapters.
- `client.js`: settings page (秘书偏好 card) and workspace channel sidebar; built into `lib/client.js` by `npm run build`.
- `tests\*.test.mjs`: routing, QR, credentials, QQ, delivery, sidebar, secretary bridge, and plugin boot tests.
- `tests\ported\*.spec.ts`: ported upstream engine specs, run with `npx vitest run tests/ported`.

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
npm test
dsh plugin --profile web add .
```

After changing the source, always `npm run build` before invoking individual tests directly — sidebar tests read the built `lib/client.js`.

When changing channel or session logic, keep the engine platform-agnostic, keep adapters from creating agents, and keep web tasks separate from IM channels.

## Validation

`npm test` builds and runs the full suite (1,200+ tests). Contract tests for management authentication use `DSH_CONNECTION_CONTRACT_ROOT`; local runs skip them when unconfigured; CI supplies both. Tests use temporary HTTP servers and credentials, not a live deployment.

`prepublishOnly` runs the tests before publishing.

> Note: two MockAgent dispatcher-injection tests (`tests/discord-proxy.test.mjs`, `tests/telegram-proxy.test.mjs`) hang on Node.js 26 and time out; run the suite on Node 22 (matching the badge above) where they pass.

## Result recovery after disconnects and restarts

Delivery tracking starts with ordinary IM messages received after this feature is enabled. If the original result is saved but sending has not started, its final text and completion status can be recovered after reconnecting or restarting. Questions, tools, approvals, and files are never replayed.

- Telegram, Discord, Slack, Feishu/Lark, and WeCom can attempt background delivery using a stable chat destination. DingTalk, QQ, and WeChat wait for a new message in the original chat to refresh the reply channel.
- When sending was attempted but delivery is unconfirmed, automatic resend pauses. Use `/delivery` to check records, then `/delivery retry <record-ID>` if you want to resend.
- Recovery is available for 7 days per record, with at most 1,000 records. Delivered and definitively rejected records are removed first when capacity is reached; expired records are cleaned up when a new message arrives.

## License

Security guidance is in [SECURITY.md](SECURITY.md).

Licensed under [Apache License 2.0](LICENSE).
