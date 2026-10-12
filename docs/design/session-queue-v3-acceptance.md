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

Only after every row passes: phase 4 may add `wb pass` to the prompts (both locales) and remove the acceptance-only broadcast switch.
