# Native session browser

Status: implemented on the feature branch, not deployed. This is a native CLI entry, not another web chat implementation.

## Interface

- The left heading switches between Group chats and Sessions. Existing columns, header and mobile drawers are reused.
- Sessions selects a device and one of its available Codex, Claude Code, Grok or Agy installations. Its left list shows recent native conversations.
- Selecting a conversation shows read-only user/assistant history in the middle and device/tool/native ID/folder in the right pane. There is no web message composer.
- The + dialog chooses a device, tool and allowed working folder. Permission bypass is an explicit checkbox, initially off; otherwise the CLI's own defaults apply.
- The role terminal dialog also opens this same new-session form, preselecting only its device and tool. It does not supply the group folder, history or role prompt. The separate history action verifies the latest resumable Run; older records remain stored, and active terminal claims keep their original binding and return controls.
- Continue prepares an exact native resume, not latest/continue/fork. Known original working folders cannot be silently changed. Unknown folders must be selected explicitly.
- The final link opens iTerm. A registered remote device uses the existing SSH command builder and the Worker's original user/environment. Copying the command is also available.

## Boundaries

`GET /api/native-sessions/:nodeId` selects `runtime` and optionally `sessionId`. Folder browsing uses the same node's allowed-root query. `POST /api/native-sessions/:nodeId/terminal` prepares or releases a single-use terminal entry. These routes require the normal human API credential, not an Agent tool credential. Workers advertise `nativeSessions:1`; old Workers display an upgrade error.

History IDs resolve only inside the selected tool's vendor directories. Reads skip symlinks, subagent folders and non-history files. Discovery is bounded to 20,000 entries and returns up to 100 recent distinct IDs; oversized transcripts are read in windows and explicitly marked partial. Credential/configuration files are not exposed. Codex, Claude and Grok messages are parsed only as user/assistant text, not executed or interpreted as platform commands. Agy DB/protobuf content currently has no decoder, so it shows metadata and the native terminal entry instead of a fabricated empty conversation.

Native terminals reuse the existing prepared/active/released lease, process-identity checks and five-minute unopened-entry expiry. Duplicate native IDs or overlapping occupied folders are refused. Existing managed execution is never stopped by this feature. A folder overlapping several group chats requires the existing owning-role terminal entry. A known group-chat folder reserves that project while open; an unrelated folder uses a terminal-only scope, without inventing a project or role. Both are returned by the existing background Worker check after exit. Closing an unused dialog requests release; copied/opened links retain the lease until expiry or native exit.

No role responsibilities, Workbench platform prompts, managed `wb` context or model requests are injected. Native CLI history, login, model selection and permissions remain owned by the native CLI. Previewing does not create a Task/Run, send a prompt, synchronize files or modify existing histories.

## Verification and limits

- Isolated catalogue tests cover exact IDs, tool separation, preserved history text, permission flags, symlinks and occupied-session/folder rejection.
- A real isolated Home and full Worker exercise HTTP/WS reads, exact-resume terminal preparation, idempotent links, duplicate rejection, allowed-root validation, release and automatic return. That test uses a controlled CLI executable and does not claim vendor-model execution.
- Real native histories on a Mac and Linux server were read without modifying their state: all four tools were listed; three yielded text previews; Agy remained metadata-only.
- A real browser exercises switching, central preview, details and the default-unchecked permission option using a controlled native-history response. The existing suite and syntax checks are also run.
- End-to-end iTerm GUI interaction and paid/native model turns across all four vendors remain release-acceptance work. A browser protocol link alone does not prove an SSH login or a successful model reply.
