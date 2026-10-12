# Session Queue V3 — Phase 1 audit

**已归档·不作实施依据。** This records the original phase-one baseline, not current behavior. The phased PRs are already integrated; supervisor tools, managed document protection and queue/continuation repairs have since changed these findings. Use [V3 acceptance](session-queue-v3-acceptance.md) for current evidence and limits, and [V3 design](session-queue-v3.md) for the authoritative contract.

Baseline: `main` @ `b7c4bd7`. Design: [session-queue-v3.md](session-queue-v3.md) (Chinese original).
Status legend: **exists** / **partial** / **missing** / **added (P1)** = implemented in this phase.

## Existing tool and identity surface

| Area | Where | Notes |
|---|---|---|
| `wb help` | `src/wb-cli.mjs`, `helpText` in `src/wb-tools.mjs` | Single CLI entry; all Home calls go through `agentRequest` with an allowlist of `/api/agent/*` paths. |
| Team query | `wb discuss peers` → `RoleDiscussions.peers` + `buildTeamContext` | Returns roles, status, recent messages. |
| History | `wb history search/read`, `wb result read` → `History` (`src/history.mjs`) | Searches room messages, run results/errors, request summaries/results; cursor + grapheme paging. |
| Sessions / summaries | `wb session current/list/summary/read`, `wb chat summary` → `SessionTools` | Reads role sessions, run results, organizer summaries. |
| Reports | `wb report` → `saveRunReport` (write); reports are only read back via run records. | |
| Run context packet | `Store.launch` → `buildRunContext` | Messages, quote, source and organizer summary injected into a new run's input. |
| Identity binding | `startAgentBridge` (Worker) | The CLI never holds `WB_TOKEN`/`WORKER_TOKEN` (`agentProcessEnv` strips them). Requests go through a per-run bridge directory; the Worker overwrites `runId` with its own run and rejects a mismatching one. |
| Server-side validation | `home.mjs` `/api/agent/*` | Requires the worker token, loads the persisted Run and derives project/role from it; `assertAgentSender` rejects sender fields. |

## Requirement mapping

| § | Requirement | Before P1 | After P1 |
|---|---|---|---|
| 2.1 | Collaboration session distinct from native session / Run | missing (only `conversationId` and discussion threads) | **added**: `collaborationSessions` records (`src/collaboration-sessions.mjs`) in the existing `records` table |
| 2.1 | Message batch, propagation cycle, explicit request | partial (`coordinationRequests` = explicit requests with target role and id); batch/cycle missing | unchanged — phases 2/4 |
| 2.2 | Home is the authoritative store; Worker holds no long queue | exists for runs/commands | unchanged |
| 3.1 | Session init: goal, delivery, background, participants, type | missing | **added** (`create`), user API only; supervisor tool deferred (needs prompt change) |
| 3.2 | Membership add/remove explicitly recorded, never deletes requests | missing | **added** (`membershipLog`) |
| 3.3 | Inheritance via reply / consultation answer / report / late reply | partial (links exist: `replyToId`, `parentRequestId`, `requestId`, `taskId`, `sourceMessageId`, `sourceRunId`) | **added** `sessionOf()` derives ownership from those links; explicit `collaborationSessionId` stamp wins; no time/keyword heuristics |
| 3.3 | Closing stops discussion only, never cancels tasks | — | **added** (`close` only flips state) |
| 4.2 | Explicit request needs receiving role + request id; `@role` text is not a task | exists (`/api/agent/calls` creates request records; mentions in text are not parsed into requests by agent tools) | unchanged |
| 9.1 | Server-side reviewer isolation on all Workbench read paths | missing | **added** `reviewView()` filters at data-access layer: history search/list/read by id, result read (runs, requests incl. continuation), session list/read/summary, chat summary, discussion read/peers, reports, run context packet (messages, quote, source, organizer summary), message attachments |
| 9.1 | Filter before pagination / summary | — | **added**: the filtered store is handed to `History`/`SessionTools`/`RoleDiscussions`, so paging cursors and summaries never see protected rows |
| 9.1 | Derived content | — | **partial (P1)**: agent messages replying to a protected opinion; organizer summaries withheld while any protected message exists. Free-text paraphrase without a link cannot be detected |
| 9.2 | Release on transition to shared discussion | missing | **added** (`release`) |
| 9.2 | No promise against terminal file reads / native context | — | documented limit; `.workbench/docs` and repo files are not filtered |
| 11 | Trusted identity: project/role/run(/batch) from runtime, reject model-supplied sender | partial: top-level sender keys only | **added**: nested identity keys rejected (`author*`, `speaker*`, `batchId`, `collaborationSessionId`, …); batch binding itself arrives with batches in phase 2 |
| 11 | `wb help`, team, history queries reused, no second tool system | exists | reused; no new CLI command in P1 |
| 11 | Prompt unchanged until `wb pass` verified | — | no prompt changes |
| 12 | Session record | missing | **added** |
| 12 | Receipt, batch, cycle, reservation records | missing | phases 2–4 |
| 12 | UI state distinctions | missing | phase 2+ (no UI in P1) |

## Gaps found but not closed in P1

1. **Shared worker token.** Home authenticates `/api/agent/*` with one worker token and trusts `runId`; it does not check that the calling Worker owns `run.nodeId`. A compromised Worker could act for another node's run. The CLI cannot (token stripped, bridge rewrites `runId`). Fix needs per-node tokens or a signed run token — suggest a separate PR.
2. **Direct (non-bridge) mode** in `agentRequest` uses `WB_TOKEN` if present; managed CLIs never receive it, but local dev invocations can.
3. **Supervisor session init tool** is not exposed to agents yet; sessions are created via the user API only.
4. **Isolation scope** covers Workbench reads only; a reviewer with shell access can still read shared repo files or `.workbench/` docs.
