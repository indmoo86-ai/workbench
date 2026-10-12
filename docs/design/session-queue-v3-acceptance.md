# Session queue V3 — real-CLI acceptance (phase 3)

The session queue stays behind the project flag, and the prompts stay unchanged until this passes for **all four** CLIs.
Use a dedicated test project with two roles on the same Worker (upgraded to this build): the role under test and one peer.

## Run, once per runtime

```
WB_HOME_URL=http://127.0.0.1:8787 WB_API_TOKEN=<token> \
node scripts/session-queue-acceptance.mjs --project <testProjectId> --busy <roleUnderTest> --peer <peerRole>
```

| Runtime | CLI version | Automated checks | Manual: native transcript clean | Manual: explicit publish / pass | Date / device |
|---|---|---|---|---|---|
| Codex | | | | | |
| Claude Code | | | | | |
| Grok | | | | | |
| Agy | | | | | |

## Manual checks per runtime

1. Native transcript: "queued note 1..5" appear for the first time in the batch turn, never during the sleep turn (no stdin writes, no native append or steer).
2. Explicit publish: the batch turn's streamed text and native final answer show in the run details only. A chat bubble appears only if the role ran `wb chat post`, and then exactly once.
3. `wb pass`: ask the role, in the batch turn, to run `wb pass` with nothing to add. No bubble; queue shows *Batch processed*.
4. `wb pass` refused: send an explicit `@role` request in the session. `wb pass` returns the "request addressed to you" error.
5. Lease: kill the Worker right after a reservation (status *Pending verification* or back to *Queued*). After restart, there is no second start for the same batch.
6. Old Worker: with a Worker from before this build, messages stay *Queued* with "Worker upgrade required".

The runner marks the project as a test project (the broadcast switch is refused elsewhere) and sets a 2-batch budget.

Only after every row passes: phase 4 may add `wb pass` to the prompts (both locales).

## Section 14 acceptance list: automated coverage

| # | Item | Automated (node --test) | Still needs real CLIs |
|---|---|---|---|
| 1 | New session via supervisor; broadcast never calls supervisor to pick recipients | p5 "acceptance #1/#16"; collaboration-sessions tests | Supervisor creating a session is still user-API only |
| 2 | Busy CLI gets no early input; merged batch afterwards | p2 "busy CLI receives nothing", p3 end-to-end | Runner + transcript check, per CLI |
| 3 | Per-role session rotation, no starvation | p2 rotation across restart | — |
| 4 | Mixed batches: only the addressed role must answer | p3 explicit request refuses pass | Real CLI behaviour |
| 5 | Streamed/final replies never auto-post; explicit post once | p3 explicit publish | Per CLI (manual check 2) |
| 6 | wb pass idempotent, no bubble, refused with open request | p3 tests | Per CLI (manual checks 3-4) |
| 7 | Concurrent dispatch within budget; @request / restart / sub-topic do not reset | p4 tests | — |
| 8 | Over budget keeps requests and late replies linked | p4 pause tests; p1 inheritance | — |
| 9 | Worker exit after reservation recovers; lost start confirmation never double-starts | p2 lease cases, p3 launch gate | Kill-Worker drill (manual check 5) |
| 10 | Review isolation on history/search/reports/quotes/summaries | p1 isolation tests | — |
| 11 | max < quiet rejected and unchanged; equal allowed | p2 config validation | — |
| 12 | Disconnect / resend / restart / interleaved topics: no loss or duplicate | p2 dedupe + sealing boundary; p3 forged answer ignored | Real network drill |
| 13 | Backlog alert deduplicated; reassignment checks execution first | p5 backlog + reassign | — |
| 14 | Silence counts valid messages only, once per period | existing follow-up tests + p5 silence test | — |
| 15 | Pause / manual takeover / capacity / old Worker stay queued | p2 old Worker; p3 adapter takeover facts | Manual check 6 |
| 16 | No unauthorised IM, session clearing or task interruption | p5 "acceptance #1/#16"; p5 close keeps accepted tasks | — |

The `wb pass` guidance is already in code, but it is injected **only into collaboration batch runs**, and those exist only while the project flag is on. Pre-acceptance it is invisible to every project with the flag off.
