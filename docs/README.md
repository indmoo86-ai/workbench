# Documentation Index

| Document | Purpose | Status |
| --- | --- | --- |
| [OPERATING-GUIDE](OPERATING-GUIDE.md) | Publishing, configuration, running single and multi-server setups, contributing, sanitization checklist | Current |
| [ARCHITECTURE](ARCHITECTURE.md) | Current code architecture, interfaces, data and implementation boundaries | Current. Describes only what the code does |
| [PROGRESS](PROGRESS.md) | Append-only development changes and verification milestones | Current; does not imply public release or deployment |
| [PRD](PRD.md) | Product goals, phase scope, business rules and acceptance direction | Scope reference. Not everything is implemented |
| [design-coordination](design-coordination.md) | Supervisor, templates, custom roles, optional plans and fixed-version hand-off | Design. Partly implemented; see ARCHITECTURE |
| [design-local-supervisor](design-local-supervisor.md) | Project supervisor, multi-repository setup, device and account configuration assistant | Implemented in the current code |
| [design-role-responsibility](design-role-responsibility.md) | Separate coordination responsibilities from execution prompts, snapshot compatibility and acceptance coverage | Implemented; runtime limits recorded in section 11 |
| [plan-role-responsibility](plan-role-responsibility.md) | Ordered implementation tasks and negative tests for excluding self responsibility from execution | Executed inline; design records actual verification coverage |
| [design-minimal-injection](design-minimal-injection.md) | Four-adapter minimal input, trusted discovery and reliable continuation | Selectively deployed; adapter-specific acceptance limits are recorded |
| [plan-minimal-injection](plan-minimal-injection.md) | Unified implementation and verification of minimal execution context | Implemented; source synchronization excluded |
| [design-role-cli-switch](design-role-cli-switch.md) | Reversible same-device CLI handoff and staged verification | Codex/Grok implemented; Claude/Agy switching not yet supported |
| [plan-role-cli-switch](plan-role-cli-switch.md) | Implementation and acceptance of safe role CLI changes | Selectively deployed; supported scope is recorded in the design |
| [design-supervisor-timers](design-supervisor-timers.md) | `wb timer` scheduled jobs and low-cost progress patrol | Implemented in the current code |
| [design-supervisor-proactive-followup](design-supervisor-proactive-followup.md) | Direct supervisor follow-up after configurable chat silence (default ten minutes), with future IM assistance notifications (Chinese) | Implemented and isolated-tested; not deployed or enabled on real projects |
| [plan-supervisor-proactive-followup](plan-supervisor-proactive-followup.md) | Implementation mapping and acceptance for direct supervisor silence follow-up (Chinese) | Executed inline with independent review; release excluded |
| [design-session-handoff](design-session-handoff.md) | Controlled cross-device role session handoff | Proposal. Not implemented |
| [design-cli-session-recovery](design-cli-session-recovery.md) | Verified idle reclaim, human confirmation and same-native-session recovery | Implemented and isolated-tested; not deployed |
| [session-queue-v3](design/session-queue-v3.md) | Authoritative conversation collaboration and external CLI queue contract | Approved V3; opt-in implementation |
| [session-queue-v3-acceptance](design/session-queue-v3-acceptance.md) | Repair verification, runtime results and remaining drill limits | Isolated-tested; no production deployment or automatic activation |
| [session-queue-v3-audit](design/session-queue-v3-audit.md) / [merge-order](design/session-queue-v3-merge-order.md) | Historical phased audit and merge sequence | Archived; not implementation guidance |

| [design-source-sync](design-source-sync.md) | Single authority for project-file sync, safe apply, conflicts and continuous folders | Implemented; legacy and directory acceptance limits are recorded separately |
| [plan-source-sync](plan-source-sync.md) | Source synchronization implementation and verification gates | Archived implementation plan; current contract is design-source-sync |
| [design-shared-documents](design-shared-documents.md) | Actual Mac-local file reading, document links and Resources integration; consumes unified project-file sync | Implemented; physical Mac/Linux and browser verification, no separate synchronizer |
| [plan-project-file-sync](plan-project-file-sync.md) | Unified directory scopes, background synchronization and actual Mac file reading | Completed; local/remote release and selective project activation verified |

Start with the README, then ARCHITECTURE. Read the PRD when you need the full product scope. ARCHITECTURE describes the actual code only and never treats a plan as a feature. Design documents may describe intended behavior; where they disagree with the code, the code is the fact.
