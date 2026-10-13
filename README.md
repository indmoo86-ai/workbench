English | [简体中文](README.zh-CN.md)

# Agent Collaboration Workbench

A self-hosted project group chat for the AI coding CLIs and subscriptions you already use. Codex, Claude Code, Grok Build and Antigravity run as configurable roles on your Mac or servers; Home owns records and coordination, while Workers drive the real native CLIs.

> Development preview (`0.4.0`), for a single trusted operator or a small trusted team. Workbench does not proxy model APIs or replace native instructions, login or tools.

## What the current version provides

- **Role-based collaboration.** Direct user assignments, supervisor coordination and role-to-role consultation through one `wb` entry. Keep role responsibilities separate from optional execution prompts; discover team, history, reports and user-confirmation tools on demand.
- **External conversation queues.** Opt-in V3 sessions collect outside busy CLIs and deliver merged batches only at a verified input boundary. Original requests, waits and late replies stay linked; necessary resumption does not consume a new propagation charge. Explicit `wb note` / `wb chat post` publishes discussion output, while native streams and final answers remain in execution details.
- **Independent review.** Workbench history, derived inputs and managed document reads remain isolated until explicit release. This is not an OS sandbox and cannot erase previously seen native context.
- **Actual local project files.** Resources and document links resolve bound Mac files by repository scope and relative path, independently of the sync switch. Opt-in saved-source/document/resource sync runs in the background, preserves conflicting versions and rechecks before writing. Git commits, review and merge remain separate.
- **Visible progress and usable UI.** Read-only live input/output/tool events, execution-only progress labels, quota reset details, local file availability and compact attachment previews. Source-tracked Runs log pre-input file-verification time separately from CLI/model work. Basic Settings tabs stay sticky; supervisor role settings remain separate from project settings.
- **Safe session operation.** Device capacity limits, five-minute idle reuse, verified leftover-process recovery and human confirmation before interrupting old work. Optional supervisor follow-up after chat silence defaults off and does not expand user authorization.

Installation does not enable collaboration broadcast, file synchronization or proactive follow-up on business projects. V3 broadcast remains test-project restricted. See [V3 design and measured acceptance](docs/design/session-queue-v3-acceptance.md), [file-sync contract](docs/design-source-sync.md), [CLI recovery](docs/design-cli-session-recovery.md) and [limitations](#limitations-and-roadmap) before enabling or exposing the service.

## Why this exists

The opt-in **Project file sync** card under Resources now supports automatic two-way synchronization of saved code, shared documents and necessary resources. Preview the project/repository scopes, select participating devices and a display Mac, then enable the reviewed scope. Workers continue observing and transferring while the page is closed; Resources and document links read the selected Mac's actual project files, not a Home-private copy. Conflicts retain both versions and use evidence-based owner notification, independent candidate acceptance and fresh receiving-file checks. Git commits, branches, review, merge and rollback remain separate; isolated outputs must be delivered to the project folder first. Existing policy-2 repository scopes retain their explicit-trigger semantics until migrated, and installing this version does not activate business projects. See the [contract and measured acceptance limits](docs/design-source-sync.md#13-unified-continuous-project-file-synchronization).

Local file viewing does not require synchronization to be enabled. A configured display Mac is retained; before configuration, exactly one bound Mac can be discovered without assuming Home is that device. Registered repository baselines, including read-only reference repositories, can be read by scope ID and relative path; arbitrary isolated worktrees cannot. Recent Outputs marks completed write evidence separately from reply references, shows confirmed Mac paths and file availability/sync errors, and does not attribute citations to a modifying CLI.

The project started from a practical situation: one person, several AI subscriptions (different vendors and models), and several machines.

- **Different models review and complement each other.** One model writes the code, another reviews it from a different angle, a third plans or tests. Each is a *role* with its own CLI, model and prompt. Independent review of a pinned Git commit is a first-class workflow.
- **Use the quota you already pay for.** Most accounts have unused tokens at the end of a period. Because a role is just "this CLI + this model + this machine", you decide how work is spread across accounts and can change that allocation at any time by editing a role. Token statistics and, where the CLI exposes it, remaining quota are shown next to the roles so the split can be adjusted deliberately.
- **Multiple servers and devices work together.** A *Home* node keeps the project state, and any number of *Worker* nodes (your laptop, a Linux server, a cloud box) connect to it and run the CLIs installed there. Code moves between devices as fixed Git commits, files move as attachments, and a supervisor role can coordinate roles that live on different machines.

The workbench does not replace the CLIs and does not proxy model APIs. It drives the CLIs you have already installed and logged in to, and it stores no vendor credentials of its own.

## Language

Project Settings provides separate, clearly labeled saves for project information and folder binding, with results shown beside each action. Project file sync is available from Project Settings and Resources. Clicking the supervisor card opens a separate Role Details dialog with the same settings/history tabs and layout as other roles; project configuration remains in Project Settings.

The **Basic Settings** tab groups language (English / 简体中文), browser API Token, WeChat notifications and the remote execution switch. The verified Home access token is saved in this browser and reused after closing and reopening it; edit it in Basic Settings when needed. Use a trusted browser profile: clearing site data, private browsing or switching to a different browser/address can require setup again. Language localizes the UI and displayed defaults, independently of model-facing instruction language. This README and the [operating guide](docs/OPERATING-GUIDE.md) are also available in Simplified Chinese: [README.zh-CN.md](README.zh-CN.md) and [docs/OPERATING-GUIDE.zh-CN.md](docs/OPERATING-GUIDE.zh-CN.md).

Project names remain user-defined text in the sidebar, its accessible labels and the workspace heading; switching the interface language does not rename them.

Managed dialogue inputs for Codex, Claude Code, Grok and Antigravity use English Workbench-maintained execution templates and a send-only Traditional Chinese prose copy. Chat records and saved custom prompts stay unchanged; custom prompts are not translated to English. Code, commands, paths, identifiers and exact quoted strings are preserved. The same policy applies to later turns and configuration events without an extra model call. It does not rewrite native history, attachments, tool results or text typed directly in an SSH terminal, and requires this Worker version on each execution device.

## Key features

Task progress uses six labels: **Pending execution, In progress, Waiting, Completed, Stopped, Execution error**. A normally delivered review is completed even when its business verdict is negative; verdicts remain in the reply and delivery report. Waiting reasons and execution errors stay visible, and process stop must be confirmed. Existing plan policies and acceptance actions are unchanged; old records are not rewritten or automatically retried.

CLI prose is displayed in Simplified Chinese in chat, live/fullscreen replies and execution output. This browser-only conversion uses a bundled OpenCC dictionary without a model or CDN request. User messages, quoted input, code, commands, paths, original-text views, copies and stored records retain their original content.

Directed role questions and published replies appear as individual chat bubbles with sender → recipient, content and time. Replies after a wait retain the original recipient even when the question is on an older history page. The question's Original button opens that message, not its sender's Run result. This display does not change dispatch, waiting, independent-review visibility or explicit-publication rules.

For document consultations, `wb call ... --text "review this document" --file path/to/document.md` reads the UTF-8 file directly, attaches its exact text and SHA256 as quoted reference data, and keeps the existing 12000-character call limit. It does not transfer or overwrite a peer's workspace. Larger shared documents should be referenced for on-demand reading; protected independent reviews keep their original document-read boundary. Retained Agy processes use the supplied `wb --turn RUN_ID ...` entry: old turn IDs never follow a new turn. `wb help` remains usable with an expired context, and a saved report receipt explicitly distinguishes registration from the later end of the CLI turn.

All items below exist in the current code. Items that are only designed are listed separately under [Limitations and roadmap](#limitations-and-roadmap).

**Collaboration**

- Project group chat with `@role` dispatch. Ordinary agent messages do not implicitly dispatch work. Explicitly enabled collaboration-session broadcast can queue a discussion batch; it never appends to a busy CLI or changes task ownership.
- Per-project roles with their own device, CLI, model, reasoning effort and Markdown prompt. Optional responsibility templates cover planning, execution, review, testing, architecture, debugging, deployment and documentation. All new template execution prompts start empty; existing roles are unchanged.
- Same-device Codex/Grok changes use **Handoff and switch** in either role editor: retain identity/history, drain accepted work, verify a new native session and commit only after process settlement. Cancel before commit keeps the original binding. Requires a compatible Worker; other adapters are explicitly unverified. See [CLI switch design](docs/design-role-cli-switch.md) for current acceptance status.
- Role names are mention identifiers (letters, digits, underscores or hyphens, without spaces); `all` and `everyone` are reserved for broadcasts. Existing role names are kept verbatim. Default intake follows the configured supervisor ID, not an English display name, and mentions support both ASCII and full-width punctuation.
- A fixed per-project *supervisor* that receives requests without an `@`, proposes repository/role configuration cards (applied only after you confirm) and can schedule multi-stage work (`wb schedule`) with parallel independent reviews and sequential or merge stages. Its card is pinned above the work roles; click it to configure its device, CLI, model and reasoning effort in Role Details.
- Structured role-to-role tools exposed to every managed CLI through one `wb` command: consult another role (`wb call` / `wb wait`), report a business verdict (`wb report`), write a hand-off note (`wb handoff`), and request a Git delivery (`wb deliver`). An `@` inside model output never dispatches work.
- Queueing, per-role and per-node concurrency limits, cancel, "steer now" for queued human messages, pause for remote dispatch, and explicit stop with confirmation from the Worker.
- Native session resume: each role keeps its vendor session across turns, with a background conversation organizer that keeps a shared project summary.
- Optional, off by default: peer discussion preview (`WB_DISCUSSION_PREVIEW`).

**Multi-device**

- Home/Worker split over an authenticated WebSocket. Workers connect outward; the Home never reaches into a machine.
- Reliable delivery: persistent command and event outbox, idempotent command IDs, reconcile-on-reconnect, and no automatic re-run of executions whose state is unknown.
- Per-device project directories and a long-lived project baseline branch per repository (Git worktrees), with fixed-SHA cross-device delivery that requires an explicit confirmation before pushing.
- Attachments (images and files, up to 6 per message, 20 MB each) with SHA-256 verification, and a "send to device" action for moving a file to another bound device.
- Device onboarding helper over SSH (installs and connects a Worker on a remote Linux machine) and an optional Home-managed reverse SSH tunnel.
- Remote desktop from a macOS Home: check the registered server's xrdp, create a loopback SSH forward or reuse a verified existing same-user forward, then open Windows App's saved connections. Unknown or ambiguous listeners remain blocked; externally managed tunnels are never stopped by this entry. Opening the app does not verify desktop login.
- Terminal takeover: continue a finished native session in iTerm (macOS entry point; remote devices are reached over your own SSH configuration), with the platform pausing dispatch on that device while you work.

**Operations**

- Scheduled jobs (once, interval, daily, weekly) and a model-free progress patrol that only wakes the supervisor on new anomalies (`wb timer`).
- Token usage statistics per device, collected with `ccusage`.
- GitHub and Gitee account storage and optional repository creation (private by default).
- Installable PWA shell, desktop three-column layout and a mobile drawer layout.
- State reads time out after 20 seconds and recover automatically without replaying task submissions. Returning to the page or reconnecting refreshes state while preserving drafts; connection details show the last successful update.
- Buffered static text and state/chat reads negotiate gzip to reduce SSH transfer overhead; streaming events and attachments are unchanged. Small page icons use the existing 192px asset, and optional high-resolution images are not eagerly downloaded for offline-shell installation.
- Optional confirmation channel over WeChat, disabled by default. It depends on an external confirmation hub that you must provide.

## Architecture overview

```
 Browser (PWA)  <--HTTP/SSE-->  Home  <--authenticated WebSocket-->  Worker A  --> codex / claude / grok / agy
                                 |                                    Worker B  --> codex / claude / grok / agy
                          SQLite (projects, roles,                    ...
                          rooms, runs, queues)
```

- **Home** (`src/home.mjs`): web UI and REST API, SSE updates, the single source of project state, the scheduler and the Worker WebSocket endpoint. Built on Node's HTTP server and built-in SQLite.
- **Worker** (`src/worker.mjs`): one per machine. Probes local CLIs, runs them in project workspaces, keeps a local database and outbox, and reports events back.
- **Runtime adapters**: Codex through the App Server protocol; Claude Code, Grok Build and Antigravity through their non-interactive print/stream modes.
- **`wb`** (`bin/wb`): the tool every managed CLI uses to talk back to the workbench. It talks to the Worker over a per-turn file bridge, so the CLI sandbox does not need network access.
- **Web UI** (`public/`): plain ES modules, no build step.

Details and interface boundaries are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The product scope is in [docs/PRD.md](docs/PRD.md).

## Requirements

- Node.js `>= 22.16` (`.nvmrc` pins a tested version). Node's built-in `node:sqlite` is used; it may print an experimental warning.
- Git.
- At least one supported CLI installed and logged in on each machine that will run a Worker: `codex`, `claude`, `grok` or `agy`.
- Optional: SSH access to remote machines if you want the device onboarding helper.

## Quick start (single machine)

```sh
nvm use          # optional, uses the version in .nvmrc
npm install      # or: npm ci
npm run dev      # starts a Home and a Worker as two separate processes
```

Open <http://127.0.0.1:4317>. The default listener is loopback only.

Then, in the UI:

1. Open the base settings and check that your device and its CLIs are detected.
2. Create a project. Pick the online device, a logged-in CLI and a model as the project supervisor, and give the project a folder name.
3. Tell the supervisor which repository to use and which roles you want, confirm the configuration cards it proposes, then `@` a role to start work.

You can also run the two processes yourself:

```sh
npm start        # Home
npm run worker   # Worker (in another terminal)
```

### Project memory: `AGENTS.md`

Each managed project keeps one authoritative memory file, `AGENTS.md`, at the project root. When Workbench creates a project folder or links an existing Git repository it writes, only if absent, an `AGENTS.md` template (project goal, rules and conventions, build and test commands, key decisions; conclusions only, under about 200 lines) and a one-line `CLAUDE.md` containing `@AGENTS.md`. Existing files are never overwritten. In a Git repository root the new files alone are committed locally (`chore: add AGENTS.md project memory`); nothing else is staged and nothing is pushed. If the commit fails (for example, no Git identity or a rejecting hook) the files are left uncommitted and the error is reported. Codex, Grok and Agy read `AGENTS.md` natively; Claude Code needs version 2.1.281 or later for `AGENTS.md`, and the `CLAUDE.md` pointer covers its default mode, which skips `AGENTS.md` whenever a `CLAUDE.md` exists. Any role may update `AGENTS.md` when a rule or key decision changes; keep it concise, conclusions only, and commit the change. Workbench no longer keeps its own memory (`wb memory` and `.workbench/MEMORY.md` / `INDEX.md` were removed; old files on disk are left untouched). Process history is available with `wb history search`.

### Where data lives

| Path | Content |
| --- | --- |
| `.data/home/` (override with `DATA_DIR`) | Home SQLite database, attachments, generated `worker-token` (mode 0600), hosting account secrets |
| `.data/worker/` (override with `WORKER_DATA_DIR`) | Worker SQLite database, node identity, outbox, runtime environments |
| `<project folder>/.worktrees/` | Per-run and project-baseline Git worktrees |
| `<project folder>/AGENTS.md`, `CLAUDE.md` | Project rules and key decisions shared by every CLI (created once if absent) |
| `<project folder>/.workbench/` | Handoff notes, temporary attachments and other platform files inside a workspace |
| `.local/` | Scratch space for local validation; never published |

Never commit any of these. See [docs/OPERATING-GUIDE.md](docs/OPERATING-GUIDE.md).

## Configuration

Role editing separates **responsibility** (used by other roles to choose collaborators) from **role prompt** (injected for that role's execution). A role does not receive its own responsibility through the team directory. Text-only edits work while its device is offline and preserve its CLI/model binding. Existing custom prompts remain unchanged; missing responsibilities are unspecified, not inferred.

The development Home/Worker contract supports minimal execution context and on-demand team discovery. Saved prompt changes apply at actual next-turn admission, not halfway through running work. The four adapters apply complete changed/revoked component events while retaining the native session; unchanged delivered versions are not repeated. Codex separately reloads a retained thread's current Run/tool environment. Explicit dependency waits can time out, resume and wait for the original request without dispatching it again. Isolated four-CLI native and cross-device acceptance passed for the documented combinations; local Agy is unavailable under the provider's location policy. This is not a production rollout. See [actual coverage and selective release gates](docs/design-minimal-injection.md#11-observed-acceptance-boundary).

Bilingual responsibility templates help collaborators choose planners, implementers, reviewers, testers and optional specialist roles. They describe the role's purpose and deliverables, not a mandatory execution sequence; template execution prompts are empty and the supervisor defaults remain separate. Existing custom role prompts and responsibilities are not rewritten. Safe automatic CLI handoff has [an approved design](docs/design-role-cli-switch.md) and an implementation plan awaiting review; it is not a released feature.

Everything is configured through environment variables. Copy [`.env.example`](.env.example) as a reference; the app does not load `.env` files by itself, so export the variables in your shell or service manager. Values below are placeholders.

**Home**

| Variable | Default / purpose |
| --- | --- |
| `PORT` | `4317` |
| `HOST` | `127.0.0.1`. A non-loopback host requires `API_TOKEN` and should be put behind an HTTPS reverse proxy |
| `DATA_DIR` | `.data/home` in the project |
| `API_TOKEN` | Browser access token, required for non-loopback listening (for example `xxxxx`) |
| `WORKER_TOKEN` | Shared Worker registration token. If unset, one is generated into `.data/home/worker-token` |
| `TOKEN_USAGE_TIMEZONE` | Day boundary for token statistics, default is the system time zone; set it to override |

**Worker**

| Variable | Default / purpose |
| --- | --- |
| `HOME_URL` | `ws://127.0.0.1:4317/worker`; for a remote Home use `wss://xxxxx/worker` |
| `WORKER_TOKEN` | Must match the Home token (for example `xxxxx`). Locally it is read from the Home data directory |
| `WORKER_ROOTS` | Allowed project root directories, separated by the OS path delimiter (for example `xxxxx`). Defaults to the project directory |
| `WORKER_DATA_DIR` | `.data/worker`; one directory per Worker, never shared by two processes |
| `WORKER_CONCURRENCY` | `2` |
| `NODE_NAME` | Display name; defaults to the host name |
| `NODE_KIND` | `local` or `cloud`; defaults to `cloud` on Linux and `local` elsewhere |
| `CODEX_BIN`, `CLAUDE_BIN`, `GROK_BIN`, `AGY_BIN` | CLI executables; set an absolute path (`xxxxx`) when `PATH` differs |
| `CLAUDE_MODEL_ID` | Model ID to advertise when `CLAUDE_BIN` points at an Anthropic-compatible launcher |
| `CLAUDE_CONFIG_DIR` | Native session directory, needed when a wrapper changes `HOME` |
| `NODE_ID`, `WORKSPACE_ROOT`, `REMOTE_DESKTOP_URL`, `CCUSAGE_BIN` | Optional overrides, see `src/worker.mjs` and `src/token-usage.mjs` |

Optional features: `WB_DISCUSSION_PREVIEW=1` together with `WB_DISCUSSION_VALIDATED_CONFIGS` (JSON array of `{runtime, model, version, bin}` entries you have verified) enables the peer discussion preview. `WECHAT_CLIENT` and `WECHAT_CLIENT_CONFIG` configure the optional WeChat channel.

### Home and a remote Worker

Run the Home on an always-on machine and connect Workers from other machines. For a few personal nodes an SSH tunnel is enough:

```sh
# on the worker machine
ssh -NT -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 14317:127.0.0.1:4317 xxxxx@xxxxx
```

```sh
# in another terminal on the worker machine
export HOME_URL=ws://127.0.0.1:14317/worker
export NODE_NAME=xxxxx
export WORKER_ROOTS=xxxxx
read -r -s WORKER_TOKEN && export WORKER_TOKEN   # paste the Home's worker token
npm run worker
```

If you already have an HTTPS/WSS reverse proxy, set `HOME_URL=wss://xxxxx/worker` and skip the tunnel. Node itself does not terminate TLS. More setups are in [docs/OPERATING-GUIDE.md](docs/OPERATING-GUIDE.md).

## Development

```sh
npm run check    # node --check over every source file (syntax only)
```

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) first.

## Documentation

| Document | Purpose |
| --- | --- |
| [docs/OPERATING-GUIDE.md](docs/OPERATING-GUIDE.md) | How to publish, configure, run and iterate on the project together |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Current code architecture, interfaces and implementation boundaries |
| [docs/PRD.md](docs/PRD.md) | Product goals and scope |
| [docs/design-coordination.md](docs/design-coordination.md) | Supervisor, optional plans and cross-device role collaboration |
| [docs/design-local-supervisor.md](docs/design-local-supervisor.md) | Project supervisor and multi-repository setup |
| [docs/design-supervisor-timers.md](docs/design-supervisor-timers.md) | `wb timer` scheduled jobs and progress patrol |
| [docs/design-session-handoff.md](docs/design-session-handoff.md) | Proposed controlled cross-device session handoff (not implemented) |
| [docs/README.md](docs/README.md) | Documentation index |

## Limitations and roadmap

Be aware of these before relying on the project:

- **Trusted operators only.** Browsers share the Home credential; there are no per-user identities or permissions, no per-device credential revocation, and no TLS inside Node. The Worker registration token is one shared secret.
- **Auto-approve execution.** Codex runs with `workspace-write` and approval policy `never`; Claude Code, Grok Build and Antigravity run with their permission-skipping flags inside the Worker-assigned workspace. There is no native per-step approval. The `wb` tool allow-list is not a sandbox against a malicious shell on the same account.
- **Single Home.** There is no replication or automatic failover; a Home on a laptop cannot dispatch while the laptop sleeps.
- **Cross-device session handoff is a design, not a feature yet.** Today you can re-bind a role to another device, deliver fixed Git commits and send attachments, but native vendor sessions do not migrate. See [docs/design-session-handoff.md](docs/design-session-handoff.md).
- **Not implemented:** other ACP runtimes, additional chat channels (Feishu), multi-user identities, manual primary/standby Home switch-over, automatic merging of delivered branches.
- Token statistics reflect local CLI history seen by `ccusage`, not vendor billing. Quota display is a best-effort probe per CLI and shows "unavailable" when the CLI does not expose it.
- A successful process exit means one execution finished, not that the work was accepted.

Project status and planned work are tracked in the issue tracker.

## License

MIT. See [LICENSE](LICENSE).
