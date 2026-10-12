# Session queue V3 — repair acceptance

Status (2026-10-12): repaired and independently reviewed in an isolated checkout. No production restart, deployment, real-project activation, history clearing or real IM was performed. The approved contract is [session-queue-v3.md](session-queue-v3.md). This record distinguishes runtime tests from deterministic coverage, not a claim that every failure scenario was exercised on every device.

## Fresh verification

- Node 22.22.1: npm ci, npm run check and 83 tests passed (56 maintained plus 27 ignored repair regressions). No new repair tests or run data are committed; existing fixtures align with protocol 2 and explicit native-acceptance facts.
- Independent review reproduced blockers before repair and repeated call/wait and discussion/reply/resolve continuations afterwards. Limits 2 and 3 both finish at used=2/reserved=0; necessary resumption does not charge again and native final stays private. Final targeted review found no remaining merge blocker.
- Real browser with isolated Home and Worker: eight checks passed. Modules load; valid settings save; invalid max<quiet does not partially toggle the feature; changed review documents, another role's private handoff and path traversal are denied; disabling the feature retains review protection; release permits changed content; private native stream is absent from group chat. The rendering fixture itself does not execute a model.

## Real CLI tests

Each row used its own real role/native session against isolated Home/Worker, not a fake runtime or another vendor's result.

| Runtime | CLI version | Measured scenario | Result |
| --- | --- | --- | --- |
| Codex, Mac | 0.157.1 | Busy foreground turn, five queued messages, merged batch, silent pass, explicit publication | Passed |
| Codex, Linux | 0.161.0 | Same independent scenario | Passed |
| Claude Code, Linux | 2.1.293 | Same independent scenario | Passed |
| Grok, Linux | 1.0.46 | Same independent scenario | Passed |
| Agy, Linux | 1.3.3 | Same independent scenario | Passed |

Checks: accepted input and PID/start identity; no queued message in the running turn's dispatched input; one merged subsequent batch; same platform/native session association; actual wb pass without a bubble; exactly one explicit public message; no automatic native-final bubble; charging only accepted batches. Foreground computation kept the turn busy; CPU utilization was not used to infer idle. Invalid earlier sleep/timing fixtures and a nested-help publication failure were retained separately, not counted as passes. Nested --help now performs no write.

Additional original-request wait/resume tests passed independently for Codex, Claude, Grok and Agy on Linux and Codex on Mac. Each real batch consulted a real peer once, registered a wait, received that same request's reply and resumed the same platform/native session. The effective Run stayed attached to the original batch, only the original batch and new consultation consumed budget (used=2/reserved=0), and exactly one explicit resume note was public. Neither waiting nor resumed native final text was published.

The initial extra test incorrectly counted the explicit call's handoff notification as native output. Its failed logs were retained; all assertions were corrected and re-evaluated against the original real-run records, not replaced by fake events or a replay. The ordinary non-batch and multi-layer continuation publication repair was then covered separately by the final regression and independent review; it was not claimed as a second full four-provider runtime scenario.

## Deterministic repair coverage

| Boundary | Evidence |
| --- | --- |
| Rotation and parent cycle | Paused-session rotation, 24 nested topics and inherited consultation budget |
| Addressed requests | Per-request receipts; generic note cannot satisfy them; formal Task reuse; pass binding/idempotency/refusal with unresolved obligations |
| Busy or old Worker | Native UUID/project-role alias, persisted active Runs, protocol-2 gate and expired-reservation tests at both adapter input boundaries |
| Delivery uncertainty | Verified non-delivery refunds; restored capacity; startup blocker retention; original Worker/Run verification without another launch |
| Review isolation | Input filtered before sealing; removed reviewer; derived request/task/Run/title; continuation provenance; open child-topic inheritance |
| Managed documents | Server-owned baseline hashes, role-private handoffs and traversal rejection, including real Worker file reads in browser tests |
| Necessary continuations | Batch retained through call/wait; discussion resolution and non-batch automatic-task resumption retain private output without repeated charging |
| Configuration | No default real-project budget; atomic parameter validation; project-scoped feature and version checks |

## Remaining acceptance limits

Deliberate Worker-crash/lost-ack and network-disconnection drills have not been repeated end-to-end with all four real CLIs. Original-Run reconciliation and duplicate prevention have deterministic coverage, not four-provider crash acceptance. Supervisor session creation is exposed through the identity-bound wb collaboration tool and tested at that contract; this run did not ask every vendor to act as supervisor.

Protection applies to Workbench-managed reads and injected inputs. It does not prevent authorized native terminal access to shared files, detect unlinked paraphrases or remove already-seen context. No production opt-in or unrestricted broadcast is approved by these results. Broadcast remains test-project restricted; installing code grants no business-project propagation budget.
