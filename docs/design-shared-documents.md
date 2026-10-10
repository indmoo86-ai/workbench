# Shared project documents: viewing and two-way synchronization

Status: proposal awaiting written-design approval. The read-only foundation is in development; nothing in this document implies a deployed feature.

## Intent and scope

The operator needs shared documents produced on either device to be available in the browser, Resources and Recent Outputs. Paths in these surfaces should refer to verified local copies on the Home computer, rather than expose an unusable path on a remote server. Opening a document must synchronize the required content before rendering it.

The approved direction includes two-way synchronization: saved edits in either device's project document directory must be exchanged. A Home display copy is not a substitute for that requirement. Existing source-sync activation, repositories, role prompts, native sessions and terminal-takeover state must remain unchanged.

Only the current project's bound `.workbench/docs/` directories participate. Markdown and plain text are supported, up to the current 600 KB reading limit. Credentials, other hidden directories, symlink escapes and other projects remain excluded. Deletion propagation is excluded from this repair: missing files are reported, not automatically deleted elsewhere.

## Existing faults

- Shared documents are written outside the Run worktree, but the browser reader authorizes only that worktree.
- The output collector discovers recent Run references, not the project's shared document directory.
- Inline-code paths are not links. Existing link conversion only visits Markdown anchors.
- `wb docs` reads project knowledge directly; it does not publish a browser entry or synchronize devices.

## Architecture

Extend the existing authenticated Home/Worker connection and document page. Do not create another server, model router or source-sync control plane.

- Workers list, read and apply shared documents under a Home-selected project binding.
- Home stores version hashes, per-device receipts, preserved versions and a local browser copy.
- CLI documents continue to live in each device's `.workbench/docs/`. The browser copy is read-only and lives in Home's private data directory.
- Resources lists shared documents independently of Run history. Recent Outputs includes these documents without fabricating a Run or modifier.
- Chat references resolve through the originating Run's project/device. Display labels and document-page metadata use the synchronized local path. Unknown or inaccessible references show a real failure, not a successful-looking local link.

## Two-way reconciliation

Use a persisted baseline hash per project and relative document path, plus each device's last acknowledged hash. Initial discovery establishes no false baseline.

1. A new document existing on one device is copied to missing peers and Home's display copy.
2. Identical contents on several devices establish one version.
3. After a common baseline exists, a single changed version is sent to peers still at that baseline.
4. Different changes to the same document produce a conflict. Preserve all observed versions; overwrite neither endpoint and do not choose the newest timestamp as a winner.
5. Files with the same name on different projects remain unrelated. Different devices' versions remain distinguishable during a conflict.

Source content is hashed before transfer, checked by Home, and checked by the recipient. A receipt is successful only after the recipient's actual saved content matches the target hash. Bindings, expected recipient hash and synchronization generation are checked again during apply. Repeated requests reuse their operation identity and must not apply twice.

Use the proven source-sync guarded-write and backup approach as a reference, without changing its source-file allow-list or enabling source sync. Before applying to a device with known active project writers, postpone the write. Preserve the original file before replacement and recheck the observed version; a late local edit must become a conflict rather than disappear. Arbitrary external editors do not honor Workbench locks, so do not claim a file-system compare/write is globally atomic against those editors.

## Conflicts and missing devices

Resources exposes each conflicting version, its device, hash and time. A resolution explicitly selects a preserved version, or accepts a separately prepared merged document. Applying the resolution still checks the original endpoint hashes; further edits invalidate it.

Notify a modifier only where actual write evidence supports the identity. Otherwise retain an unattributed conflict and notify the project supervisor/operator; do not infer ownership from a role name or a report claiming completion. Detection and synchronization do not require a model call.

An offline device keeps pending synchronization and its last receipt. The browser may show a previously verified local copy, explicitly labelled cached with its synchronization time. A device is not labelled synchronized before its receipt arrives. On reconnect, compare actual current hashes before applying pending work; never replay an old overwrite blindly.

## Triggers and compatibility

Refreshing shared resources or opening a shared document performs bounded discovery and reconciliation. Add an explicit synchronization action for retries; no permanent model-driven polling. Concurrent requests share the same in-flight synchronization operation.

Read-only document discovery and two-way apply have separate advertised Worker capabilities. Old Workers cannot receive apply payloads. An unsupported device remains visible with an upgrade reason; existing Run document reading continues to work.

## Implementation surface

- `src/run-document.mjs`: preserve Run-file authorization and add the explicitly shared document scope.
- `src/project-document-files.mjs`: bounded shared-directory discovery, hashing, reads and guarded apply.
- `src/project-documents.mjs`: project/binding validation, synchronization baselines, receipts, conflicts and local display copies.
- `src/home.mjs` and `src/worker.mjs`: authenticated document routes and existing transport integration.
- `public/markdown.js`, `public/document.js`, `public/workspace-inspector.js` and related markup/locales: links, local-path display, Resources entries, conflicts and synchronization feedback.

## Acceptance and release gates

Verify on isolated macOS and Linux directories before using live documents:

- Server-created document becomes a local shared file and clickable local browser copy.
- Local edit reaches the server; server edit subsequently reaches the local device.
- Identical edits coalesce; different edits preserve both versions and expose a conflict.
- A new edit during transfer or resolution is not overwritten by a stale apply.
- Retry, restart and reconnect preserve the baseline and do not duplicate apply.
- Offline reads are visibly cached; offline writes do not falsely report synchronization.
- Symlink, traversal, cross-project, credential and oversized-file requests are rejected.
- Same-named documents, nested directories and non-ASCII names remain distinguishable.
- Code-formatted, plain-text and Markdown-linked document references open the correct document; unrelated text/code blocks are not converted.
- Resources and Recent Outputs display the local path and real synchronization state in both interface languages.
- Existing Run files, source-sync settings, role/native history and manual terminal leases are preserved.

Back up runtime data and update only idle services. Record code, commit, deployment and actual two-device/browser verification separately. Do not report this work complete after only making the current screenshot's link clickable.
