# Continuous project folder sync and Mac-local file viewing

Status: revised proposal awaiting written-design approval; not implemented or deployed.
This document replaces the previous shared-document-only proposal in place. The existing implemented sync contract remains in [design-source-sync](design-source-sync.md); this document is the single source for the proposed continuous project-folder extension.

## 1. Intended outcome

The selected Mac and servers keep independent actual project directories. Saving eligible source, documentation or resource files on either side automatically queues changed-file synchronization, even when no browser is open.

Resources, document/file content, displayed paths and Open project folder refer to the selected Mac's actual bound project directory. They must not read a Home-private display copy or silently fall back to server content.

Shared documents under `.workbench/docs/` are part of the same project-file synchronization mechanism. There is no separate document synchronizer, browser-only replica or second conflict system.

Home can subsequently move to a server without changing the project's selected Mac display device or directory. File synchronization does not replace Git delivery, merge branches, run a deployment or imply business acceptance.

## 2. Verified current gaps and choice

The existing code already supplies content hashes, manifests, per-device receipts, staged changed-file transport, guarded apply/recovery, conflict preservation and modifier-owned repair.

It currently captures registered Git repository roots, requires a committed-tree baseline, excludes the entire `.workbench` directory, and is triggered by a human/agent request or managed handoff. It has no save-time continuous project-folder synchronizer. Current browser document authorization is Run-worktree-based.

Extend this engine rather than creating a document-only service or introducing a separate external folder-sync service. Those alternatives would duplicate baselines/conflicts and would not, by themselves, connect the browser to the Mac's actual files.

The unfinished read-only document modules from the previous attempt are not the implementation target and must not be published as satisfying this design. Reuse only relevant document authorization/link handling; remove the duplicate cache/synchronizer during implementation.

## 3. Scope and activation

Each project configuration fixes participating node IDs, real directory bindings, scope revision and a separately selected `displayNodeId`. The display node is the operator's Mac Worker, not inferred from Home location or a generic local/cloud icon.

Add a project-folder scope to the current engine. It includes ordinary project-root files and explicitly selected repository subdirectories. Each relative path has exactly one owner scope; nested repositories must use their selected bindings, never an accidental recursive crawl. Keep existing repository-only manual mode compatible.

Include source files, project documentation and necessary ordinary resource files, including binary assets. Do not restrict synchronization to Markdown or text. Preview actual included/excluded paths before activating a project; software installation alone leaves other projects' settings unchanged.

Mandatory exclusions remain Git metadata, dependencies, build outputs, caches, logs, credentials, environment secrets, CLI login stores, sync recovery files and running/isolated worktrees. The narrowly defined exception permits `.workbench/docs/`, including its eligible document resources, while excluding the rest of `.workbench/`. Git ignore rules must not silently remove this explicit exception. Sender and receiver enforce the same versioned policy.

Ordinary source ignore rules remain applicable elsewhere; additional needed resources must appear explicitly in scope preview. Filename exclusions do not prove that ordinary source/document files contain no embedded secrets. Symlinks, hard links, special files, boundary escapes and receiving-filesystem name collisions remain rejected.

Retain the current bounded transfer limits: 20 MiB per file, 100 MiB changed content per batch and 10,000 manifest paths per scope. Over-limit or incomplete capture is visible and never converted into an apparently successful partial directory.

Activation selects continuous mode and the exact reviewed paths/devices. It does not alter role prompts, native sessions, terminal leases, Git HEAD/index or permissions outside those paths.

Repository-specific read-only and writable-scope rules still apply. A directory being readable or writable by the operating-system account is not enough to authorize it as a receiving scope; scope preview must expose and block incompatible bindings.

## 4. One baseline and reconciliation contract

Reuse the engine's project/scope canonical revisions and per-device acknowledged manifests. Continuous file scope uses explicit saved-content baselines, not timestamps or arbitrary Git HEAD equality.

For new project-folder scope, compare complete device captures before establishing the base: identical existing files establish equality; a file present on only one endpoint can be offered to absent peers; differing same-path existing contents open a conflict before either is overwritten. Do not make the first-scanned dirty directory the winner.

Existing repository-only mode retains its current Git-baseline requirements. Scope upgrade is explicit and generation-fenced; do not reinterpret old captures as project-folder snapshots. Git metadata is not copied, and file-content equality never claims Git-history equality.

Each saved change is compared against the acknowledged per-file base. One changed side can update peers still at that base; equal concurrent edits coalesce; different edits preserve base and all sides as a conflict.

Stable source snapshots and staged hashes make queued transfer independent of subsequent source saves. Each apply checks current target bytes, binding and generation again. A target edit during transfer creates a conflict rather than a silent overwrite. A successful receipt names the actual resulting saved hash; stale/duplicate commands cannot advance the latest state.

## 5. Continuous detection independent of the page

Workers monitor eligible bound paths in their background process. Use filesystem change notifications as hints, including editor atomic-save patterns; do not treat a single notification as a complete change record.

Coalesce bursts with a proposed 500 ms quiet window and a 2 s maximum scheduling delay, then hash stable saved files. These are defaults to measure on macOS/Linux, not a promised transfer deadline. Large transfers, active writers, conflicts, offline nodes or changed scope explicitly explain longer delays.

Keep a persistent dirty-path queue and reconciliation cursor. A bounded periodic scan, plus startup/reconnect scans, recovers missed notifications and newly created/deleted directories. Watcher failure reports degraded scanning and cannot falsely claim normal second-scale latency.

Refresh only affected manifest entries during ordinary saves; avoid rescanning every Git object for every keystroke. Complete scans still define initialization and safe deletion reconciliation. Unsaved editor buffers are outside scope.

A receiving write generates local watcher events. Suppress an echo only after rereading the actual file and matching the acknowledged hash; do not ignore a path for a time window that could hide a genuine local edit.

Scope disable, binding changes and project removal stop/fence watchers and old work. Global execution/sync pause prevents transfer/apply but retains discovered dirty changes. Home unavailability keeps pending changes locally; no second peer control plane is introduced.

## 6. Offline recovery and concurrent writers

Both devices may keep saving while disconnected. Persist pending changes before considering them offered or delivered. On reconnect, reconcile actual current files with baselines before replaying any queued apply.

Reuse existing apply journals, preserved originals, content verification and idempotent receipts. A disconnect, process restart or lost acknowledgement must not duplicate writes or lose newer local content.

Synchronization may observe and queue changes while roles run. Apply to a path only when its execution/synchronization ownership is settled; a busy target stays pending rather than killing its CLI or clearing terminal takeover. Scope-level fallback arbitration is allowed where reliable per-file ownership is unavailable and must be visible.

External editors do not honor Workbench reservations. Keep the guarded backup/recheck approach and preserve unexpected displaced bytes; do not claim a globally atomic file-system compare-and-swap against arbitrary external writers.

Restarted Workers reconcile their local journals before advertising readiness for new writes. Pending transfers are tied to their original binding and generation, not redirected to whichever device is currently online.

## 7. Deletes, renames and conflicts

Represent a confirmed deletion as a versioned tombstone. Absence caused by an offline device, failed/partial scan, ignored path or changed policy is not deletion. A received delete applies only when the target remains at the expected base; otherwise preserve the target as a delete-versus-edit conflict.

A rename is an addition plus a deletion in one recorded change set. Prepare and validate both paths before apply, preserve the old version, and journal per-path effects. Do not promise a cross-file-system atomic multi-path rename. If interrupted, recover the recorded change set and expose partial/pending status until receipts settle.

Concurrent rename-versus-edit, rename-versus-rename, name collisions and recreated deleted files must preserve all observed versions. Never select a winner by modification time.

Reuse current conflict records, preserved file versions, owner assignment, notification and Task/Run repair. Hash-bound successful write evidence can identify a modifier; unknown/shell/external writers go to the supervisor without inventing an owner. Repeated detection does not create duplicate repair tasks.

An accepted resolution remains bound to the conflict generation and endpoint hashes. A further edit invalidates the candidate. Keep the current independent acceptance requirement before distributing a repair; automatic notification is not automatic approval.

## 8. Mac-local page and link semantics

The page requests file inventory/content through the selected Mac Worker using a Home-authorized project/scope binding. That Worker resolves and reads the actual local file. Home may stage transport/recovery bytes internally, but they are not the page's long-lived file source.

Resources lists actual eligible Mac files independently of recent Run references. Recent Outputs may link an evidenced output to the same inventory without fabricating its modifier or a Run. Markdown rendering and other existing bounded previews remain appropriate to the real file type.

Chat references in Markdown links, inline-code paths or ordinary path text resolve from the originating project/scope to the corresponding Mac-relative path. Leave code blocks and unrelated URLs unchanged. The displayed path, file details and Open project folder action all refer to the real Mac location.

A new server file not yet received by the Mac is a pending remote item, not a fake local file or local link. Show Waiting for local synchronization until the Mac confirms the expected saved hash. When it arrives, the page enables the real local entry.

An already existing Mac file can still be read while newer remote changes are pending, but label it as the current local version and show the pending/conflict state. Do not substitute remote bytes and label them local. If the Mac is offline, report Local device offline; do not fall back to Home-private cached content under a local-looking path.

Isolated worktree outputs are not silently mapped onto Mac project files. They need the existing controlled handoff/publication path to land in the shared project scope; otherwise remain visibly isolated/unsynchronized.

## 9. Compatibility and implementation boundaries

Extend existing source-sync modules and protocols with explicit project-folder policy/capability versions. Old Home/Workers must reject unsupported captures/apply/watch instructions, not accept newly included document paths under the old exclusion policy.

Reuse source-sync status, conflict and receipt records; add the continuous dirty queue and local display binding to existing configuration/storage. Do not retain the preliminary document-cache service as a parallel route.

Affected areas are source selection/manifests, Worker watcher lifecycle and safe apply, Home orchestration/receipts, project binding/configuration, local-file/document authorization and Resources/Recent Outputs/Markdown UI. The implementation plan must keep old manual mode and ordinary Run reading regressions visible.

Update current architectural facts only after implementation. This proposal does not redefine the already-deployed acceptance statements in design-source-sync.

## 10. Acceptance

Measure on real isolated Mac/Linux directories; then verify the selected live project without destructive test cases:

1. With no browser open, save a server source file, shared document and necessary resource. The Mac actual project files receive matching bytes; opening the page later reads those exact Mac files and paths.
2. Save edits on the Mac and receive them on the server, then repeat in reverse. Record actual normal-save latency rather than asserting a saving percentage or unconditional time guarantee.
3. Home on a different machine still reads the explicitly selected Mac; the document path and folder action do not follow Home location.
4. Initial different contents, two-sided edits, identical edits, transfer-time edits and delete-versus-edit preserve the correct versions and conflict state.
5. A new/deleted/renamed file, editor atomic save, new directory and binary asset propagate under the stated rules. Cross-platform name collisions remain blocked without overwriting.
6. Close the page, disconnect/restart a Worker/Home, save offline, reconnect and lose/replay acknowledgements. Dirty queues and baselines survive without stale overwrite or endless echo.
7. Source ignore rules and the explicit .workbench/docs exception work on both endpoints. Credentials, dependencies, Git metadata and isolated worktrees remain excluded; failures/incomplete scans do not become deletions.
8. Busy/unknown writers, terminal takeover, pause, unsupported Workers, scope changes and project deletion fence apply and late receipts correctly.
9. Known modifiers receive one correct repair request; unknown writers route to the supervisor. New edits invalidate old repair proposals.
10. Resources, Recent Outputs and document links show actual local, waiting, conflict or offline state. Verify Chinese/English, project switching and delayed responses against stale-path/old-project display errors.
11. Git HEAD/index, roles/native history and terminal leases are preserved. No Git push, deployment or model call is caused merely by a filesystem notification.
12. File counts, scan/watch limits, CPU and normal-save latency are recorded. A third unavailable physical device is pending, not advertised as tested.

Completion separates the revised design, implementation, local tests, real two-device/background acceptance, browser acceptance, commit/push and deployment. No current business scope is activated just by installing the software.
