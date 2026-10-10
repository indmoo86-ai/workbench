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
