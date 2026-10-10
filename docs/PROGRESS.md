# Development Progress

## 2026-10-10 — Managed input language

- Implemented English Workbench-maintained execution templates independently from interface localization, with send-only Simplified-to-Traditional prose conversion for all four managed dialogue adapters. Original chat/configuration records and exact executable/identity text remain unchanged. Current behavior and exclusions are defined once in [ARCHITECTURE](ARCHITECTURE.md#managed-input-language).
- Verified 23 targeted checks on macOS and Linux, 13 existing tests, syntax/whitespace checks, and 24 isolated native CLI turns. The native runs cover initial execution, unchanged continuation after a UI-language switch, changed/cleared prompts and exact-session cold resume; final checks use Chinese role names. Claude native user-input records confirm conversion independently of its Simplified display hook.
- Independent read-only review findings about exact quotes, build commands, trusted names and Home-side template language were reproduced and fixed. Tests and execution evidence stay in ignored private directories.
- This records implementation and isolated acceptance only. No public push, merge, or installation into ongoing services was performed for this change.

## 2026-10-10 — Project settings usability

- Moved basic-information saving into its section, kept independent configuration actions, and placed project deletion in a separate danger section. Important project actions show localized text alongside their icons.
- Scoped results to their originating operation, clear stale results when that section is edited, and aligned the device-folder action with its selector. Project settings and Resources now use the same project file sync name.
- Real isolated browser checks cover basic/supervisor save isolation, folder binding, folder preparation, sync entry, language switching, cancelled deletion and three viewport sizes. Syntax checks and the existing test suite passed; private screenshots and execution records remain outside Git.
- The same checks passed against a Linux-hosted isolated Home/Worker. Runtime revision `26eda55` was installed into the existing local Home/Worker and connected remote Worker; post-release browser checks and asset comparisons passed. Configuration, native-session associations and execution history were retained, and the previous dispatch-pause setting was restored.

## 2026-10-10 — Terminal takeover recovery

- Status refresh now verifies terminal processes with the corresponding Worker and returns unused or exited takeovers. Offline, unsupported or unverified processes retain their locks. A human-only stop-and-return action terminates only identity-verified processes and waits for exit before releasing the project queue.
- Recorded owner/start identity for new launchers and CLIs, retained stopping capacity, and fenced late preparation/completion. Terminal dialogs update their device, takeover and execution gates with current state and identify the actual takeover owner.
- Nine real-process checks passed on both macOS and Linux. Isolated browser acceptance covers refresh, graceful/forced exit, cancellation, offline/old capability handling, language/mobile layout, actual Codex terminal startup and stopping, exact historical resume, and original native-session continuation without duplicate queue execution. Private fixtures and screenshots remain ignored.
- Final process checks expanded to ten on each platform, including a changed-owner identity case. Legacy/missing owner metadata was checked in the actual browser. Runtime revision `e7d91ad` was installed into the existing local Home/Worker and connected remote Worker; live refresh, asset hashes and capability reporting passed. Role configuration, native associations, execution history and delivery approvals were preserved, and the prior dispatch-pause setting was restored.

## 2026-10-10 — Claude effort discovery

- Replaced empty Claude effort metadata with native per-model capability discovery, preserving existing aliases, provider identities, role settings and unspecified defaults. Initialization is bounded, non-persistent and does not send model input, run hooks or start MCP servers.
- Eight targeted checks cover supported/unsupported metadata, provider mapping, legacy compatibility and default/new/resumed execution parameters. The existing thirteen tests and syntax checks passed. Real CLI probes and isolated Home/Worker browser acceptance passed on macOS and Linux: role save/reopen/default restoration, supervisor save, language switching and mobile layout, without creating managed model Runs.
- Early Linux browser assertions used an insufficient five-second window while role/supervisor save-time checks were pending; waiting for the actual HTTP results passed. Private fixtures and screenshots remain ignored. This change has not yet been pushed or installed into the running services.
