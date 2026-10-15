# Source and outputs synchronization implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution. Do not delegate or publish this change from the side conversation.

**Goal:** Add opt-in output synchronization without changing existing project policies, losing evidence, or transferring private runtime state.

**Architecture:** Extend the existing directory capture, common baseline, receipts and migration gates. An explicit versioned content policy travels from preview through configuration, commands and apply; older Workers must reject the expanded mode. Preview transfers metadata only, not newly eligible file bodies.

**Tech Stack:** Existing JavaScript ESM, Node 22, SQLite, HTTP/WebSocket and unbundled browser UI.

**Spec:** The approved requirements are recorded below; the existing transfer and conflict contract remains in [design-source-sync](design-source-sync.md).

## Approved scope and constraints

- Existing configurations retain source-only behavior. Add `contentMode: source-and-outputs` only after preview and explicit activation through the existing disable/preview/enable migration.
- Exclude version-control metadata/worktrees, local runtime state and bridge/recovery files, dependencies, credentials/keys and CLI login directories. Recognize runtime databases/token files inside `.local` too; do not exclude all of `.local`.
- Include otherwise eligible `.workbench`, `.local`, reports, logs, coverage and Git-ignored outputs. Keep `build` and `dist` excluded by default. Retain path, link, nested-repository and scope-overlap safety checks.
- Keep 20 MiB/file, 100 MiB/batch, 10,000 files/scope and 1 GiB/project storage limits. Show bounded, structured limit evidence; an incomplete scan cannot become a successful deletion-bearing manifest.
- Write new handoffs into stable device subfolders. Retain existing handoffs read-only as fallback; preserve private-review path checks and per-Run duplicate suppression.
- File names cannot detect embedded secrets. Show this limitation before activation. Preview must not upload file bodies before the user has reviewed the expanded file list.
- Preserve history, files, reports, ongoing tasks and other local edits. No production activation, restart, deployment or Git publication in this increment.

## Review focus

1. Legacy Workers silently ignoring a new policy: capability and capture-version gates on both ends (task 1).
2. `.local` containing active databases, token files or sync staging: mandatory filename/runtime boundaries and no feedback loop (task 1).
3. Oversized previously synchronized files: blocked scan keeps baseline and peer copy intact (task 2).
4. Preview uploading sensitive bytes before approval, or stale preview enabling changed bindings: metadata-only transport and exact migration fencing (tasks 1 and 3).
5. Private handoffs becoming visible or duplicate auto-handoffs after path changes: node/role identity and legacy reads tested (task 2).

## Task 1: Versioned selection policy and preview transport

**Files:** `src/source-sync-manifest.mjs`, `src/source-sync-scopes.mjs`, `src/source-sync-files.mjs`, `src/source-sync.mjs`, `src/source-sync-worker.mjs`, `src/source-sync-transport.mjs`, `src/worker.mjs`.

**Interfaces:** `contentMode` is absent/source-only for legacy behavior, `source-and-outputs` for opt-in expansion. Expanded scopes carry the policy in `scopePolicy` and require a new Worker capability/capture version. Preview emits normal validated metadata with no blob publication; actual capture repeats freshness checks after activation.

- [x] Add local failing tests for old/new inclusion, mandatory exclusions at every depth, tracked/ignored files, overlap and legacy-worker rejection.
- [x] Run the focused tests and confirm the missing behavior fails.
- [x] Implement policy propagation, receiver validation and metadata-only expanded preview; keep existing migration revision/generation checks.
- [x] Verify previews leave files, blob stores and active bindings unchanged; mismatched policy/version cannot activate or apply.

## Task 2: Limit evidence and device-specific handoffs

**Files:** `src/source-sync-manifest.mjs`, `src/source-sync-files.mjs`, `src/source-sync-storage.mjs`, `src/source-sync-worker.mjs`, `src/source-sync-watch.mjs`, `src/source-sync-transport.mjs`, `src/wb-tools.mjs`, `src/worker.mjs`, `src/home.mjs`, `src/collaboration-sessions.mjs`, runtime locales.

**Interfaces:** Limit failures retain a stable reason plus bounded path, limit and observed-size/count metadata across capture, watcher, transport and browser status. New handoff paths use stable node IDs, including inside the existing private-role prefix; no automatic relocation/deletion of historical files.

- [x] Add failing regressions for each limit, blocked scan with an existing baseline, two-device handoffs, private-review denial and legacy latest fallback.
- [x] Implement evidence propagation without successful partial manifests or unlimited retries; do not relax apply-time checks.
- [x] Update all handoff writers/readers and automatic per-Run detection together; inject trusted device identity rather than asking the model to invent one.
- [x] Verify history remains readable, old latest files are not rewritten, active task processes remain untouched and another role cannot read private handoffs through the managed API.

## Task 3: Settings and real isolated verification

**Files:** `public/source-sync.js`, `public/locales/zh.js`, `public/sw.js`, `README.md`, `docs/ARCHITECTURE.md`, `docs/design-source-sync.md`, `docs/README.md`.

**Interfaces:** A source-only/source-and-outputs selector resets preview validity. The preview exposes included/excluded paths and the embedded-secret warning. Limit evidence remains visible on blocked batches/watchers, not only as raw codes.

- [x] Add browser assertions for default selection, expanded preview, warning, disabled activation on failed preview and persistence after reload.
- [x] Implement the UI using existing dialogs and APIs, without new polling or dependencies.
- [x] Run real isolated Home/Worker synchronization in both directions, preserving Git HEAD/index, files outside scope and an unrelated active task; exercise conflicts, limit recovery and receipt replay.
- [x] Run focused regressions, existing sync tests, syntax and whitespace checks; inspect real desktop/mobile rendered settings.
- [x] Update actual implementation/verification documentation and a private handoff. Report local versus physical cross-device coverage separately. Do not commit shared dirty files or deploy without separate authorization.

## Current state

Implemented locally and checked with real isolated Home/Worker/browser processes. Expanded-preview bodies remained local, both directions transferred outputs, and limit recovery preserved the peer file. Physical Mac/Linux verification, Git publication, deployment and business-project activation are not performed. The broad regression run passed 151 of 152 checks; the remaining historical Codex stdout assertion also fails against the unchanged HEAD module and is unrelated to this increment. Focused output-policy checks and real browser verification passed.
