# Cross-device Q/F Read Routing — P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the user selects delegation. Steps use checkbox syntax for tracking.

**Goal:** Deliver the first independently usable part of the approved v2.3.1 design: bounded, truly read-only device queries and current-source file reads through the managed wb bridge, without waiting for unrelated synchronization or relaxing formal Git delivery.

**Architecture:** Extend the existing authenticated Home/Worker query channel and managed per-turn bridge. Home owns caller authorization, registered source identity, review visibility and project-local opt-in; Worker verifies the actual directory and returns stable bytes or process facts. Existing Mac display-file routing, synchronization journals/baselines, native recovery and G scheduling keep their existing semantics.

**Tech Stack:** JavaScript ESM, Node.js 22, built-in SQLite, existing WebSocket transport and node:test. No dependency or frontend framework.

**Spec:** [design-cross-device-execution.md](design-cross-device-execution.md), v2.3.1, SHA256 `ef6149b428138839f4eb8c8789b0653714d48066dce3b212ba4a91aa2053ef5b`.

**Plan revision:** 2, incorporating the serialized-reply, requestId replay and exact-baseline review findings. These are implementation-plan corrections, not evidence that the runtime defects are fixed.

**Status:** P1 implemented sequentially on the isolated feature branch and independently reviewed on 2026-10-14. Both final findings were reproduced and fixed in one RED/GREEN pass. Isolated actual Mac/Linux/wb and browser checks passed on code commit `06dd33fb85b89290549de455891ff415b1b3e7a9`. Integrated into `fix/shared-project-documents` on 2026-10-14. Production deployment and business-project enablement remain separate; existing services were not restarted.

## Exact code baseline and worktree handoff

- Product-code baseline: `daacf7403976ccf338052cd91a65d7b4ed17f1f2`, the committed v2.3.1 design baseline. Its ancestry contains `5dafbdc`; neither `c0cc851`, a moving branch tip nor uncommitted WIP is an interchangeable starting point.
- At that exact SHA, Home sets maxPayload=1048576 at src/home.mjs:1092; Worker sets the same limit at src/worker.mjs:909. Home's disconnect path at 1184–1190 puts the affected nonterminal Runs into reconciling. Worker query is at 537, current project-file replies at 579–582, and the legacy file/document replies at 874–883. readProjectFile's raw 600000-byte ceiling is at src/project-file-read.mjs:10. CliSessionRecovery.check at 109–117 can reclaim idle drivers, and inspect at 72–107 can retire records.
- Those source anchors were checked against the committed objects, not the other reviewer's c0cc851 workspace. The eleven code modules inspected for this plan match that SHA's bytes; paths and symbols must be rechecked if the implementation source differs.
- After plan confirmation, create the feature worktree from the complete baseline SHA above. Carry the approved plan/index/progress through a documentation-only commit and record its full SHA separately; applying that commit must leave src/, public/, package.json and package-lock.json byte-identical to the product-code baseline before the first code task. Do not describe an as-yet uncommitted plan as an available Git baseline.
- This SHA is verified locally, not assumed available on a reviewer's remote. Before external code review, provide the corresponding readable source through an approved artifact or Git delivery. Lack of the object is an explicit preparation blocker, not a reason to use c0cc851 or update a busy production directory.

## Global Constraints

- Q default: 5 seconds, at most 100 result rows and 256 KiB. These are actual registered-query limits; the design's p95 figures are only unmeasured performance candidates.
- F first increment supports source_current and expected_version directly from the explicitly selected source. allow_cached, receiver-cache fill and ordinary-directory materialization remain unsupported until their own storage/apply gates pass; do not silently downgrade.
- Stable-file input uses readSourceFile and the current SOURCE_SYNC_LIMITS: fileBytes=20*1024*1024. The current 600000-byte raw-text ceiling is only one check, not a safe transport budget. Every complete file reply, including type/id/result/error and JSON escaping, must be UTF-8 serialized and fit within 524288 bytes before sending. Both 1048576-byte WebSocket receive limits stay unchanged.
- A file reply over the 512 KiB serialized budget returns only bounded metadata, preview=too_large, content=null and reason=serialized_response_limit; it retains the actual whole-file hash/size/permissions and never masquerades as a complete text. Oversized metadata itself yields a small response_too_large error. Apply the same final-frame guard to existing project_file and legacy file/document/collaboration-document replies; do not refactor unrelated task/event transport. No offset/limit paging in this first increment.
- Same owner/operation/requestId plus the same normalized input joins the original operation and replays its original terminal result with the original observedAt. Different normalized input with the same ID returns request_conflict. A genuinely new source observation requires a new requestId. Replayed results explicitly say replayed=true; do not present them as new source-current observations.
- Completed replay results persist privately before the Agent success response. Hot-path attempt metadata stays separate from result bodies. The first increment has a 32 MiB serialized-result budget in Home, with an atomic per-request reservation bounded by 524288 bytes, actual-size accounting and free-space checks. This is a bounded protocol-result store, not a receiver file cache/materialize feature or an OS disk quota. Insufficient storage blocks the new attempt; no successful response without a retrievable original result, no silent eviction of old evidence and no fresh read substituted for an unavailable original result.
- No complete repository capture for F; no execution_snapshot, Git-clean gate, file apply, worktree creation or source-sync activation in Q/F.
- Preserve project, scope, node, workspace/generation and real path ownership. A managed Run source is not replaced by its ordinary project directory.
- Preserve reviewGuarded and prereview document baselines. Matching hash or known pathname never grants access; raw CLI output and credentials are not query data.
- Reuse the existing private project/Worker storage. New read-binding/receipt metadata is allowed; do not update sourceSyncDevices, task/Run business state, audit conclusions or files as a query side effect.
- Publish queryRecipes=1, fileReadFreshness=1 and readSourceBindings=1 only after each corresponding path is actually wired. Do not advertise fileSetInputs, serviceConsumers or new S capability.
- No changes to running native sessions, production configuration, existing synchronization switches, user files or uncommitted quota/frontend work. No push, deployment or restart in this implementation authorization.
- Work in a new project-owned worktree from the exact product-code baseline, then carry only the separately approved documentation commit as described above. Keep test scripts/evidence in ignored .local/cross-device-p1-tests; do not commit tests, credentials or real infrastructure identifiers.

## Review Focus

1. "Check" is not inherently read-only: current CliSessionRecovery.check may reclaim idle drivers and inspect may retire stale Run records. New Q must perform neither (Task 2).
2. Same path but different directory/source: rebinding, replaced directories, deleted managed worktrees and changed scope layout must invalidate observations rather than return ordinary-project bytes (Tasks 1 and 3).
3. Changed file with unchanged historical receipt: source_current must return this attempt's actual bytes/hash or fail, including when synchronization is off (Tasks 2 and 3).
4. Independent-review derivation and alternate source node: new tools must not expose unpublished peer files, reports, process details or content through errors (Task 3).
5. Transport and retry boundaries: escaped text must not disconnect the Worker or disturb other Runs; duplicate IDs replay the original observation, expired turns and unknown Worker versions never gain new permissions (Tasks 2–5).

## Scope and follow-on gates

This plan implements design P1 direct queries and source reads, with only the binding metadata needed to locate real sources. It does not implement the full P0 shared I/O/quota subsystem, receiver content caching, file.materialize, S freezing/preparation/execution or cross-role services.

P2/P3 follow in a separate plan after this increment has evidence: versioned canonical inputs, committed-plus-worktree capture, base selection, blob references/reservations, protected execution trees, executionContext and native binding. P4 adds service consumers; P5 adds safe ordinary-directory materialization and other explicitly gated scope. None is marked complete by this plan.

## File structure and ownership

| File | Responsibility |
| --- | --- |
| src/read-source-bindings.mjs (new) | Resolve only registered bound_project/managed_run sources; keep stable read-workspace identity/generation and compare ownership snapshots |
| src/node-query-recipes.mjs (new) | Immutable two-recipe allowlist, strict schemas, output limits and fixed pure handlers |
| src/cross-device-read-worker.mjs (new) | Validate actual source on the device, stable single-file read, real observedAt and source proof |
| src/read-query-response.mjs (new) | Construct and byte-budget the complete JSON reply; metadata/error fallback without dropping the Worker connection |
| src/read-result-replay.mjs (new) | Owner-scoped normalized request identity, durable terminal results, bounded storage and replay without fresh source reads |
| src/cross-device-read.mjs (new) | Home authorization, project read configuration, Worker dispatch and reviewed response checks |
| src/cli-session-recovery.mjs | Add a side-effect-free observation path without altering ordinary check/reclaim behavior |
| src/store.mjs | Bounded native-driver lookup/index and new metadata cleanup compatibility |
| src/home.mjs / src/worker.mjs | Register narrow endpoints/actions and capability discovery |
| src/agent-bridge.mjs / src/wb-cli.mjs / src/wb-tools.mjs | Managed read-tool discovery, strict command payloads and immutable turn binding |
| src/collaboration-sessions.mjs | Source-aware read authorization that preserves caller identity and old document semantics |
| src/locales/en.mjs / src/locales/zh.mjs / package.json | Messages, help and syntax coverage; no public UI redesign |
| README.md / README.zh-CN.md / docs/ARCHITECTURE.md / documentation indexes | Only facts actually implemented and tested; edit the new worktree copies, never overwrite concurrent WIP |

## Task 1: Registered source identities and bounded query contracts

**Files:** Create src/read-source-bindings.mjs and src/node-query-recipes.mjs. Local test: .local/cross-device-p1-tests/contracts.test.mjs.

**Interfaces:**
- normalizeReadQuery(input) -> {requestId,sourceNodeId,recipeId,recipeVersion:1,params,freshness:'source_current'}; only workspace_check and cli_session_check are valid recipe IDs.
- normalizeFileRead(input) -> {requestId,sourceNodeId,sourceWorkspace,scopeId,path,freshness,expectHash?,metadata}; expected_version requires a lowercase 64-character SHA256. Unknown fields, arrays, null, duplicate CLI flags and executable commands reject.
- resolveReadSource(db,callerRun,selector) -> trusted descriptor {projectId,sourceNodeId,sourceRunId?,workspaceKind,workspaceId,scopeId,root,scopePolicy,bindingSnapshot}; no caller-provided root.
- registerReadSource(db,descriptor,workerProof) -> {workspaceId,generation,scopeId,scopeGeneration,bindingVersion}; readWorkspaceBindings stores only project/node/source IDs, validated root/proof and monotonic generations.
- readSourceStillCurrent(db,callerRun,descriptor,proof) -> boolean; checks current registration and owning Run without scanning all historical Runs.

- [ ] **Step 1: Write failing contract tests.** Assert invalid recipe/version, action/stop/reclaim/confirm injection, arbitrary SQL/shell, traversal/absolute/symlink paths, cross-project scopes and forged source node ownership reject. Assert unsupported cache mode does not become source_current.
- [ ] **Step 2: Run RED.** Run node --test .local/cross-device-p1-tests/contracts.test.mjs; expected failures identify missing new exports, not unavailable infrastructure.
- [ ] **Step 3: Implement the schemas and identity resolver.** bound_project uses workspaces and repositoryWorkspaces; managed_run uses the owning Home Run's actual workspace/workspaceRunId/repositories. Check project, node and repository IDs. Never use projectRoot as a failed managed-run fallback.
- [ ] **Step 4: Register real identity only after Worker proof.** Legacy bindings do not invent generation=1 without validation. Match the authenticated device's canonical directory proof and source Run. Increment generation only when the validated directory/owner/layout changes; returning to an old path still invalidates old references. Supplied stale workspace/generation must reject.
- [ ] **Step 5: Add tests for unchanged registration, rebind, same pathname with replaced physical directory, missing managed worktree and nested scope exclusion.** New metadata must leave original binding and sync records unchanged.
- [ ] **Step 6: Run GREEN and commit owned files only.** Add modules to package.json syntax coverage when integration makes them executable. Do not stage local tests.

## Task 2: Truly read-only Worker recipes and stable direct file reads

**Files:** Create src/cross-device-read-worker.mjs and src/read-query-response.mjs; modify src/node-query-recipes.mjs, src/cli-session-recovery.mjs, src/store.mjs, src/project-file-read.mjs and src/worker.mjs. Tests: worker.test.mjs, reply-budget.test.mjs and recovery-observe.test.mjs under the ignored test directory.

**Verified existing behavior:** CliSessionRecovery.check calls reclaim(binding,fingerprint,false) for idle blockers. inspect may call retire and emit historical status. Therefore the new query must not delegate to either current path with its existing defaults.

**Interfaces:**
- Store.readNativeDriverRecords(binding,{limit:100}) -> {records,partial}; targeted SQL filters project/role/native-session before JSON materialization. Preserve normal recovery selection/order; incomplete query coverage returns unknown/partial, never falsely ready.
- CliSessionRecovery.observe(binding) -> {state,processes,partial,readOnly:true}; uses a no-retire inspection option and never check/reclaim/stop/emit/put. Existing check and reclaim remain unchanged.
- executeReadQuery({request,source,workspaceCheck,observeSession,clock}) -> {recipeId,recipeVersion,sourceNodeId,observedAt,items,partial,truncated}; handler dispatch is fixed in code.
- inspectReadSource({db,descriptor,projectRoot,nodeId}) -> physical source proof; validates allowed roots, realpath/directory identity and managed Run/repository ownership.
- readSourceCurrent({source,input,clock}) -> {readSource:'source',sourceNodeId,readNodeId,workspaceId,generation,scopeId,scopeGeneration,relativePath,hash,size,executable,observedAt,freshness,matched,preview,content}; missing files return explicit missing; unsupported previews keep the full-file metadata without fake text.
- budgetReadReply({id,result,error},{maxBytes:524288}) -> {message,serializedBytes,metadataOnly}; counts Buffer.byteLength(JSON.stringify(message),'utf8') for the final complete reply. The message passed to send is exactly the checked object, with no fields appended afterward. Metadata fallbacks are reserialized and checked; unsafe errors do not echo the oversized input.

- [ ] **Step 1: Write a failing idle-driver test.** Give the recovery object an idle native driver, instrument stop/emit/put, call observe, and assert all mutation counts are zero and the original driver/Run remains unchanged.
- [ ] **Step 2: Write file and frame tests using actual temporary files.** Cover dirty/unsynced source, binary/empty files, raw text above 600000 bytes, changed byte despite old receipt, permission/deletion/replacement. Add 600000-byte all-quote, all-backslash, U+0001-control and ordinary files plus non-ASCII text: complete reply bytes, not JS character count, determine metadata fallback. Pin <=524288 exactly, >524288 fallback and the final metadata/error frame cap. Count the stable reader calls; no captureDirectorySnapshot or Git command for F.
- [ ] **Step 3: Run RED, then add pure observation.** Extend inspection with an explicitly no-retire path; the current recovery path keeps its default behavior. Add a sparse/indexed native-driver lookup for Q; do not introduce a full-history poll or change old scheduler semantics.
- [ ] **Step 4: Implement Worker query execution.** Hardcoded handlers use workspace HEAD inspection or observe, not dynamic action strings and not current cli_session_check. Use a new narrow read_query action and source_read action on the existing query channel. Limits: 5000 ms, 100 output rows, 262144 serialized bytes; timeout never signals a native process.
- [ ] **Step 5: Implement source inspection, stable reads and the final-frame guard.** Reuse readSourceFile/readProjectFile boundaries; use Worker observedAt, not mtime, and recheck identity/generation after reading. expected_version mismatch returns allowed metadata with matched=false. Route new source-read and existing project_file/file/document/collaboration_documents replies through the same complete-message budget; unsupported legacy metadata shapes return a small explicit error rather than an unsafe frame. Do not raise maxPayload, truncate text into fake success or mutate a checked reply before sending.
- [ ] **Step 6: Test row/byte/timeout limits, PID reuse/unknown state, metadata fallback, corrupt replies and no Host/token/command-argument exposure.** Use an owned child and isolated 1048576-byte-capped Home/Worker sockets. Sending each guarded 600000-byte pathological file must leave the socket open, the child alive and concurrent nonterminal Run states unchanged. Test both new Agent reads and existing page file previews; never use production sockets for overflow probes.
- [ ] **Step 7: Run GREEN, the maintained suite and syntax checks.** Commit code only; do not advertise new capabilities until Home/bridge support is connected.

## Task 3: Home source authorization, opt-in and response validation

**Files:** Create src/cross-device-read.mjs and src/read-result-replay.mjs; modify src/home.mjs, src/collaboration-sessions.mjs and src/store.mjs. Tests: home.test.mjs and replay.test.mjs under the ignored directory.

**Interfaces:**
- CrossDeviceRead constructor({db,query,online,clock}); inspect(run,input), query(run,input) and read(run,input) are Agent read methods.
- configuration(projectId) / updateConfiguration(projectId,input) use private projectReadAccess metadata {id:projectId,version,enabled,nodeIds,scopeIds,recipeIds}. Default is disabled; no automatic enabling of real projects.
- POST /api/agent/read-source, /api/agent/node-query and /api/agent/file-read accept {runId,input}; project and sender come only from the live persisted Run.
- GET/PUT /api/projects/:projectId/read-access are authenticated human configuration routes, version-checked. Agent routes cannot enable themselves or broaden limits.
- reviewSourceFileAllowed(db,callerRun,{sourceNodeId,reviewPath,hash,scopeId,sourceRunId}) -> boolean; old reviewDocumentAllowed delegates with its original source context and keeps its old behavior.
- beginReadOperation(db,callerRun,operation,normalizedInput) -> {operationId,state,inputHash,replayed}; owner includes the trusted project and Run, not caller-supplied sender fields. Existing inputHash mismatch rejects before querying a Worker. readOperations contains small state/identity metadata only.
- saveReadResult(db,operationId,terminalResult) -> savedResultReference; persist the validated bounded full original result in a separate readResults record before success, and settle the storage reservation atomically. Result retrieval is by operationId, not a full-state history scan.
- replayReadResult(db,callerRun,operationId) -> {replayed:true,replayedAt,result}; the nested result and its observedAt are unchanged. Recheck current caller/project/read/review authorization; revoked permission denies replay without deleting the stored result or changing the original conclusion.

- [ ] **Step 1: Write failing authorization tests with actual in-memory Store.** Test unknown/stopped/expired Run, unconfigured scope/device, cross-project source Run, old Worker capability, terminal/switch maintenance and unexpected input keys. No read grants by raw absolute path.
- [ ] **Step 2: Write visibility sentinels.** Prereview approved document versus one-byte-changed text, another reviewer's private handoff, unpublished derived Run, alternate source node, unknown scope and denied error. Assert sentinel is absent from response/body/metadata/error and no unauthorized read dispatch occurs when path is already forbidden.
- [ ] **Step 3: Run RED and implement the controller/opt-in endpoints.** Authorize the current caller and look up the owner-scoped operation before a new dispatch. Existing completed operations take the authorized replay path without requiring the source to be online or rereading its current bytes. For a new operation, resolve source via Task 1, reserve result storage, snapshot configuration/generation, check target online/capability and issue fixed Worker queries. Physical registration is control metadata, not a source-sync baseline.
- [ ] **Step 4: Validate replies before returning.** Verify the complete reply budget and project/source/scope/workspace identities, path mapping and entry schema. Verify text byte/hash consistency when complete text is present; metadata fallback does not claim Home has independently reconstructed the file body. Apply source-aware review permission after actual hash is known and recheck configuration/binding after await before persisting success. Malformed, oversized or changed replies fail closed; replay rechecks current authorization without a new source observation.
- [ ] **Step 5: Implement owner-scoped durable replay.** Identical ID/input joins the in-flight operation or returns its saved terminal result with unchanged observedAt and explicit replay metadata; no new source dispatch occurs. Same ID/different normalized input returns request_conflict. Only a new requestId starts another current-source observation. Home restart restores completed results from the result store; an incomplete/unknown operation without its original result stays pending/reconciling or read_result_unavailable, never silently rereads the source under the old ID. Save success only after reply/review validation and bounded result persistence; a lost upstream HTTP response can replay safely.
- [ ] **Step 5a: Pin replay invariants in RED/GREEN tests.** Read bytes A with ID r1 at t1, change source to B: r1 returns A/t1 without a Worker query, while new r2 returns B/t2. Cover key-order-equivalent normalized parameters, different parameters, concurrent duplicates, dropped HTTP response, Home reopen, missing result body, storage exhaustion and permission revocation. Stored metadata/results must be read by indexed identity only; replay must not regenerate observedAt, recapture source_current or broaden visibility. Under this plan, file/query retries use the same rules, including failed terminal outcomes.
- [ ] **Step 6: Add source timeout/offline/rebind races and configuration revocation tests.** Source offline never returns a cached latest result; ordinary directory busy/dirty does not block direct reads. Disable affects new reads without stopping old native work.
- [ ] **Step 7: Prove sourceSyncDevices/manifests/journals, old Mac display selection, tasks/reports/history and G input gates are unchanged.** Use before/after record digests; no change() events that fabricate task progress.
- [ ] **Step 8: Run GREEN and a real isolated HTTP/Worker roundtrip.** Commit owned production files only.

## Task 4: Managed wb tools, capabilities and honest help

**Files:** Modify src/agent-bridge.mjs, src/wb-cli.mjs, src/wb-tools.mjs, src/worker.mjs, backend locale resources, package.json and documentation. Test: bridge-cli.test.mjs.

**Interfaces:**
- wb read source <JSON> -> inspect source identity.
- wb read query <JSON> -> node.query wrapper; the registered recipe remains fixed and read-only.
- wb read file <JSON> -> direct F read. Exactly one JSON argument; no shell expansion, arbitrary action alias or ignored trailing option.
- wb-tools exports inspectReadSource(input), queryNodeReadOnly(input), readDeviceFile(input), routed through agentRequest only.
- New endpoints are allowed for existing accepted work during pause only while the immutable per-turn identity remains valid. Switch maintenance retains its existing history-only rule.
- Worker reports capabilities queryRecipes=1, fileReadFreshness=1, readSourceBindings=1 and fileReadModes=['source_current','expected_version']; old Workers fail explicitly unsupported.

- [ ] **Step 1: Write failing CLI/bridge tests.** Current and expired --turn IDs; retained native process cannot follow the next turn; forged runId/projectId/sender; malformed JSON/duplicate args/unknown actions; paused accepted read versus cancelled task.
- [ ] **Step 2: Run RED and register only the three endpoints/commands.** Add managed wrappers, immutable turn checks and bilingual help. Do not copy Home/Worker token into native environment or permit direct network escape.
- [ ] **Step 3: Wire capabilities only after Tasks 1–3.** Keep old docs/sync/git commands and their permission boundaries untouched. Query config discovery returns allowed IDs/settings, not tokens.
- [ ] **Step 4: Add integration tests using the actual bin/wb process and existing bridge.** Assert source/observedAt, safe metadata fallback, same-ID replay versus new-ID observation and request_conflict. Help explicitly says use a new requestId for a new observation and reuse it only for retry. Unsupported modes never fall back to materialization/full capture; a replay result is not a newly executed source read.
- [ ] **Step 5: Update README, architecture, progress and both indexes for P1 only.** Explicitly say S, content-cache fill, materialization and multi-consumer services remain designed/not implemented; do not write all v2.3.1 is complete.
- [ ] **Step 6: Run all focused tests, npm run check, npm test, git diff --check.** Commit code/documentation, not private tests/evidence.

## Task 5: Isolated device/page verification and branch review

**Files:** Private .local/cross-device-p1-tests/{acceptance.mjs,browser.mjs,results.md}; implementation status in plan/design/indexes only after evidence exists.

- [ ] **Step 1: Start isolated Home plus separate Mac/Linux Workers with private data and dynamically chosen ports.** Record the full fixed starting code SHA, approved documentation commit, feature HEAD and source-module hashes. Use only provisioned private connection details; never substitute c0cc851 if the baseline object is unavailable. Do not restart production services, reuse production Worker databases or modify a business project's sync switch.
- [ ] **Step 2: Bind distinct ordinary roots and a managed test Run/worktree, with a source-only saved change and unrelated dirty files.** Configure read opt-in only for this isolated project through the human route.
- [ ] **Step 3: Use the real wb bridge/client to read Linux bytes from a Mac caller and the reverse.** Record full code commit, actual source root, registration/generation, SHA256, observedAt and no synchronization/apply/worktree operations caused by Q/F.
- [ ] **Step 4: Change the source file, keep an old successful receipt, then query with a new requestId.** New hash or truthful stable-read failure is required. Replaying the old ID returns its original authorized result/observedAt and explicit replay flag, not the new bytes. Test source offline for new requests, lost HTTP reply, Home reopen, rebind and actual same-path directory replacement without touching production connections.
- [ ] **Step 5: Query an owned idle dummy CLI/session.** Identity, PID reuse and timeout coverage must preserve all actual processes and historical records. An incomplete record set returns partial/unknown, not a no-process conclusion.
- [ ] **Step 6: Verify a real browser against the isolated Home.** Existing Mac document/Resources selection stays intact. Preview pathological 600000-byte quote/control files: metadata or explicit size error appears, Worker remains online and the concurrent test Run keeps its original state. Browsing does not switch source or write files; review sentinels stay absent. Distinguish real wb/Worker transport from model behavior; no four-native-adapter claim from a fake fixture.
- [ ] **Step 7: Run performance samples and keep actual counts/bytes.** No recurring full-history or whole-tree reads introduced. Candidate p95 performance is reported, not asserted without measurements; no closing sync or deleting history to lower usage.
- [ ] **Step 8: Complete an independent branch review after the chosen execution method permits it.** Reproduce findings and fix only owned problems, rerun affected checks; unavailable real-device checks remain explicit blockers to the corresponding acceptance claim.
- [ ] **Step 9: Handoff P1 code/commit/isolated verification separately from deployment.** No push/restart/baseline update included. Provide concrete P2/P3 next-plan prerequisites rather than marking the project complete.

## Spec coverage and explicit gaps

P1 covers the direct-read/query portions of A01/A02/A03/A29/A31/A63/A65/A71/A73/A74 and relevant A25 compatibility. A33/A34 are exercised only for source resolution and refusal of fallback, not S freezing. A55's prohibition on ordinary-directory writes is checked, but cache materialization is not implemented; A56 remains unsupported. A27/A28 receiver reuse, A72 execution-directory observation, S matrices A04–A24 and later resource/services/multi-scope cases require subsequent plans and must not be claimed passed here.

The five Review Focus cases each have owning tests in Tasks 1–4. Query/no-retire semantics preserve the spec's read-only requirement even though the existing automatic-recovery check is not safe to reuse. The phase-specific refusal of cache/materialization is the design's explicit unsupported path, not an unapproved omission.

## Execution choice

User selected inline execution on 2026-10-14. Execute tasks sequentially in this conversation, followed by one independent whole-branch review.

The implementation gate is now open for this isolated worktree only. Production services, configuration and unrelated changes remain outside this authorization.

## Revision 2 review reconciliation

| Finding | Plan correction | Owning checks |
| --- | --- | --- |
| Escaped file text can exceed the 1 MiB transport cap | 512 KiB complete JSON reply preflight, rechecked metadata/error fallback, shared narrow protection for existing file previews; no cap increase or new paging | Task 2 frame boundaries and Task 5 concurrent-Run/browser checks |
| requestId retry versus a new fresh read was ambiguous | Original completed result and observedAt replay for the same owner/ID/input; new ID for new observation; durable bounded storage and explicit unavailable/revoked cases | Task 3 Step 5/5a, Task 4 wb help/bridge and Task 5 fresh/replay device checks |
| Starting code commit was unspecified | Full daacf7403976ccf338052cd91a65d7b4ed17f1f2 baseline, committed-object source anchors, separate documentation handoff and actual feature/version evidence | Baseline section and Task 5 Step 1 |

The user confirmed this revised plan and its logical implementation order. Plan corrections by themselves do not prove a runtime fix; actual implementation evidence is recorded below.

## P1 implementation and verification handoff

The approved documentation-only commit is `49ccf0468637c3cdcfc44da73277d49cff63ef36`. Tasks 1–5 produced commits `dfb1fc8`, `53481ee`, `083545c`, `16c843c` and `72a7f9e`; final code fixes are in `06dd33fb85b89290549de455891ff415b1b3e7a9`. The original v2.3.1 design and its recorded hash remain unchanged. This section records implementation evidence separately from design approval.

- Focused private checks: 31/31. Maintained suite: 56/56. `npm run check` and `git diff --check` passed. Tests and actual-device artifacts remain in ignored project-local storage rather than the repository.
- A fresh independent whole-branch review identified unauthorized nested-project access through a parent repository grant and a unique prior-Run lookup still scanning role history. Both had failing reproductions before their fix; the corrected path rejects excluded files before Worker dispatch and uses the Run primary key without a history sort. No finding is deferred.
- Separate actual Home, Mac Worker and Linux Worker instances used private databases and ephemeral forwarding. Real wb processes and immutable bridges read saved source bytes in both directions, including an uncommitted file in a real managed Git worktree. No vendor-model turn was launched.
- Actual checks covered original-ID replay versus new-ID freshness, offline replay versus truthful fresh-read failure, physical-directory replacement, missing managed directories without fallback, nested-scope exclusion and stale generations. Original results survived both actual Store reopen and an isolated Home-process restart. The deterministic test caller was readmitted only after expected startup reconciliation and Worker reconnection; this does not claim live vendor-session recovery or a production restart.
- Quote, backslash and control-character files of 600000 bytes returned bounded metadata. Workers stayed online, the owned concurrent test Run stayed running and its process stayed alive. Real browser Resources and standalone document pages showed the serialized-size reason, retained Mac selection and did not offer full-text copying when unavailable.
- The final twenty warm local wb/bridge/F samples measured median 187.58 ms and p95 191.99 ms. A short Home/Worker sample measured 1.1%/0.5% CPU and about 104.9/94.3 MiB RSS. These are isolated observations, not sustained idle, peak-memory, production-improvement or SLA evidence. The first actual-device check used a clean code worktree; the additional Home-restart check ran with only these documentation edits pending and verified identical source-module hashes.
- Source-sync baselines/batches, reports, user files, existing native sessions and unrelated quota/frontend modifications were not changed by this increment. Q/F remains opt-in; installation does not enable a real project.

The P1 code/isolated-verification gate is complete and its commits are integrated into `fix/shared-project-documents`. Production rollout and four-provider model-turn acceptance remain separate. Receiver cache/materialization, the full P0 resource subsystem, S execution and service handoff are not implemented by these commits; their next plans must satisfy the follow-on gates above before opening writes or execution.

The feature branch's final packaging check corrected only two newly added comments to the existing English source style required by the maintained i18n test. Runtime logic was identical to the actual-device-tested code; its full suites and syntax/whitespace gates applied to that packaging state. That packaging step did not itself integrate or deploy the feature; the later integration state is recorded above.
