# Unified project-file synchronization implementation plan

> Execute inline with superpowers:executing-plans. The user has confirmed the scope and authorized implementation and local/server verification; do not add another scope approval round.

Goal: automatically exchange saved project code, shared documents and required resources, and read the selected Mac's actual files in the browser.

Architecture: extend SourceSync and its existing durable transport, receipts and recovery journal. Add directory scopes and Worker background change detection. Browser file access resolves through the selected display Worker; no display-copy synchronizer.

Spec: design-source-sync.md section 13 and design-shared-documents.md.

## Global constraints

- Node 22, JavaScript ESM, existing Home/Worker transport and source-sync storage.
- Git owns commits, branches, reviews, merges and rollback; synchronization does not change HEAD/index or imply delivery acceptance.
- One physical file has one scope owner. Preserve isolated outputs until explicit delivery to the project directory.
- Preview and version actual bindings/policy; preserve existing projects' activation unless explicitly selected for this rollout.
- Retain conflict versions and verify recipients before applying; mtime cannot decide a winner.
- The Mac display Worker is independent of Home location. Unreceived files stay pending.
- Tests and fixtures remain in ignored project-local directories; no fake model runs for acceptance.

## Review focus

1. Different project/container/repository layouts must map the same scope-relative file correctly.
2. A save while receiving, or during offline/restart replay, must not be overwritten by a stale operation.
3. Git-ignored shared documents must be included without admitting the rest of platform state or credentials.
4. Manual and watcher requests, including received echoes, must not duplicate writes or conflict repair.
5. A displayed local path must read the actual selected Worker's file, including when Home runs elsewhere.

### Task 1: Unified directory scopes and guarded filesystem I/O

Files: source-sync-manifest.mjs, source-sync-files.mjs, source-sync-worker.mjs, new source-sync-scopes.mjs; ignored directory-scope tests.

Interfaces: directory scope bindings carry scopeKind, excludeRoots and shared-document policy; captureDirectorySnapshot(options) returns the existing manifest shape with an explicit filesystem baseline; applySourceChanges keeps its existing journal/receipt API.

- [ ] Add failing non-Git/code/document/resource capture and safe-apply tests against the current Worker.
- [ ] Implement stable bounded directory capture, exact shared-doc exception, exclusions and scope ownership.
- [ ] Extend safe apply/recovery to directory scopes without invoking Git commands.
- [ ] Verify two-way modifications, deletion, binary files, collision/traversal, changed targets and old Git capture/apply regressions.

### Task 2: Home coordination and conflict compatibility

Files: source-sync.mjs, source-sync-transport.mjs, source-sync-conflicts.mjs, source-sync-agent.mjs and scope binding helpers.

Interfaces: existing config gains mode/displayNodeId and directory-scope bindings; existing batches/commands/receipts use the same queues and identifiers with a versioned directory capture policy.

- [ ] Test initial equal/new/conflicting directory snapshots, overlapping bindings and old Worker rejection.
- [ ] Extend scope preview/activation, initialization and command/receipt validation without fabricating Git commits.
- [ ] Preserve one conflict owner and use the existing assignment/repair flow for filesystem scopes; reject stale resolutions.
- [ ] Verify manual/watcher deduplication, generation fencing, conflict preservation and source-mode compatibility.

### Task 3: Persistent background change detection

Files: new source-sync-watch.mjs, source-sync-transport.mjs, worker.mjs, home.mjs.

Interfaces: versioned watch configuration comes from Home; Worker records dirty state and acknowledged observed hashes, emits persisted change notices and reconciles on reconnect. Notices request the existing synchronization pipeline.

- [ ] Test saved changes with no browser, receiving echoes, rapid saves and restart/offline replay.
- [ ] Implement eligible-directory watchers plus bounded reconciliation and burst coalescing (500 ms quiet / 2 s scheduling target).
- [ ] Preserve notices until acknowledged, merge queued changes and report degraded/busy/offline state.
- [ ] Verify real Worker background propagation without calling any model.

### Task 4: Actual Mac file reading and UI

Files: run-document.mjs, run-artifacts.mjs, home.mjs, worker.mjs, markdown.js, document.js, workspace-inspector.js, source-sync.js, markup/locales/service worker.

Interfaces: project file inventory/read requests resolve source references to a selected display-node binding; results include actual local path, sync/receipt state and bounded content. No Home display cache.

- [ ] Remove the unused prototype copy service; keep only authorized local-file reading helpers where useful.
- [ ] Test inline/plain/Markdown file links, actual local reads, remote-only pending files and offline display nodes.
- [ ] Add continuous configuration/display-node selection to existing sync settings and expose shared documents in Resources/Recent Outputs.
- [ ] Verify English/Chinese, delayed project-switch replies and ordinary Run-document access.

### Task 5: Physical verification, review and rollout

Files: ignored local and remote fixtures/deployment evidence; README/ARCHITECTURE updated after observed acceptance.

- [ ] Run existing suite, syntax checks and focused synchronization regressions.
- [ ] Test isolated physical Mac/Linux bidirectional saved code/docs/resources, page-closed operation, conflicts, delete/rename, offline/restart and receipt replay.
- [ ] Get one fresh whole-branch review and address substantive findings.
- [ ] Preserve current runtime configuration/native sessions/terminal leases; back up data and update idle local/remote services.
- [ ] Activate only the reviewed project scope, verify the user's actual document and real browser paths, and report exact commit/deployment/acceptance state.
