# Phase 1 — Agentic Execution Layer Implementation Spec

> **Scope:** the file-level implementation plan for the Phase-1 MVP defined in
> `docs/AI_AGENT_STRATEGY.md` §6 and locked in §9 (D1–D4). Plan only — no code
> in this deliverable. Each workstream names what already ships, the gap, the
> files to add/extend, the additive data model, acceptance criteria, and the
> monetization hook.
>
> **Locked decisions carried in (strategy §9):**
> D1 separate scoped PRs · D2 MVP = Action Queue spine → Sourcing → Diligence →
> Memo + Chief-of-Staff brief · D3 **propose-only, human approves** · D4
> seat + usage + outcome (meter every agent run).

---

## 0. Headline: Phase 1 is mostly wiring, not greenfield

The repo already ships the hard parts of the Agentic Execution Layer. The
propose → approve → audit **spine exists**, three of the four MVP agents have
**working AI cores**, and **usage metering** is already in place. Phase 1's job
is to consolidate these into one operator-facing loop and close named gaps —
not to build from scratch.

| MVP piece (strategy §6) | Already shipped                                                                                                                                                                             | State           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Action Queue + approval | `lib/actions/tasks.ts` (`assignTask`/`runTask`/`decideTaskRun`), `public.task_runs` + `public.tasks`, `lib/queries/dashboard/team-tasks.ts`, `lib/team/capabilities.ts`, `trust_events`     | ✅ spine exists |
| Sourcing Agent          | `lib/ai/target-discovery.ts`, `POST /api/targets/discover`, EDGAR cron `/api/cron/intelligence`, `lib/ai/intelligence-pipeline.ts`, `generate_signal_matches`, `lib/queries/match-inbox.ts` | ✅ core exists  |
| Diligence Agent         | `lib/diligence/orchestrator.ts` (`runDiligence`, 7-agent), `diligence_runs`, `POST /api/diligence`, `lib/ai/diligence-qa.ts`, `lib/queries/diligence.ts`                                    | ✅ core exists  |
| Memo & Scorecard Agent  | `lib/ai/material-review.ts` (reasoning-tier verdict/score/strengths/gaps), `lib/capital-formation/material-review.ts`, `lib/actions/materials.ts`                                           | ◐ partial       |
| Chief-of-Staff brief    | `app/(shell)/command-center/page.tsx`, `lib/queries/command-center.ts`, dashboard queries (`majorAlerts`, `activityFeed`, `stageKpis`)                                                      | ◐ partial       |
| Usage metering (D4)     | `lib/credits/meter.ts` (`meterAction`), already wired on `target_discovery`                                                                                                                 | ✅ exists       |

**Implication:** Phase 1 = **four small, scoped PRs** (D1) that wire these
together. No new auth, no new providers, no money movement, no LP acceptance —
fully inside the §8 guardrails.

---

## 1. Existing spine — what `task_runs` already guarantees

`supabase/migrations/20260609182000_team_task_runs.sql` (+ `_automation`,
`_harden`) already encodes D3 exactly:

- A `task_run` is a **proposed** action (`action` one-liner + ordered `steps`
  jsonb), `status ∈ {proposed, approved, rejected}`.
- **"Nothing executes against external systems in this phase"** — a run is an
  authorization record (the migration's own words). This _is_ propose-only.
- Every propose/approve/reject writes to `trust_events` (Chain-of-Trust audit).
- A **partial unique index** (`task_runs_one_open_per_task_idx`) keeps `runTask`
  idempotent — one open proposal per task.
- RLS via `private.is_org_member` / `private.is_org_admin`; `agent_slug`
  constrained to the 15 frozen roster slugs.

So the control plane is done. What's missing is (a) a **first-class Action
Queue surface** that aggregates proposals across all agents, and (b) an
**executor** that, on approval, runs the (low-stakes) agent core to _produce
the deliverable_ — still no send/sign/money.

---

## 2. Workstreams

Recommended sequence: **P1-A → P1-B → P1-C → P1-D** (spine first; each later
stream reuses it). One branch + draft PR per stream (D1).

---

### P1-A — Action Queue surface + run executor (the spine, made first-class)

**Goal.** One operator surface that lists every agent's pending proposals with
evidence + the specialist's rationale, and an `approve`/`reject` control; on
approve, dispatch the run to its agent executor to produce the deliverable
(propose-only: no external side effects).

**Builds on.** `lib/actions/tasks.ts`, `lib/queries/dashboard/team-tasks.ts`
(`TaskProposalSummary`, `normalizeTaskStatus`), `lib/team/capabilities.ts`
(`proposalForTask`), `task_runs` table, `trust_events`,
`lib/actions/earn-actions.ts` (`executeEarnAction` — the existing
"approved tool → audited server action" pattern to mirror).

**Add / extend.**

- `app/(shell)/action-queue/page.tsx` — server component; the dedicated review
  surface (today proposals only live on the Team-tasks board inside
  command-center).
- `lib/queries/action-queue.ts` — `getPendingRuns(orgId)`: aggregate
  `task_runs WHERE status='proposed'` joined to `tasks`, returning action,
  steps, owning specialist, linked entity, created_at. RLS-scoped, fail-soft.
- `components/action-queue/ActionQueueView.tsx` + `RunProposalCard.tsx` — reuse
  `components/ui/*`; one card per proposal with approve/reject + decision note.
- **Extend `decideTaskRun`** in `lib/actions/tasks.ts`: on `approved`, look up a
  **run executor** by `agent_slug`/`action` and invoke it. Add
  `lib/agents/executors.ts` — a registry mapping a run to its low-stakes core:
  `deal-sourcer → discoverTargets`, diligence slug → `runDiligence`, memo →
  `composeMemo` (P1-C). Mirror `executeEarnAction`'s shape: each executor is an
  existing, audited, RLS-safe function; the run can't do anything the operator
  couldn't. Write a `trust_events` row on completion. **No** send/sign/money
  executors registered in Phase 1.

**Data model.** None new — `task_runs`/`tasks` suffice. (Optional additive:
`task_runs.result_ref jsonb` to point at the produced artifact; additive +
idempotent if added.)

**Monetization (D4).** Meter on approval via `meterAction(orgId, '<agent>_run')`
in the executor, fail-open on infra / fail-closed on insufficient balance —
exactly as `POST /api/targets/discover` already does.

**Acceptance.** Pending proposals from any specialist render with rationale;
approve dispatches the executor and produces an artifact; reject records a note;
both write `trust_events`; idempotent (no duplicate open runs); no external side
effects; CI green (`format:check`, `typecheck`, `lint`, `build`).

---

### P1-B — Sourcing Agent: standing brief → ranked candidates as proposals

**Goal.** Turn the one-shot Target Scout into a **standing sourcing brief** that
runs on a schedule, scores candidates against the mandate, writes them to the
match inbox, and raises an Action Queue proposal summarizing the batch.

**Builds on.** `lib/ai/target-discovery.ts` (`discoverTargets`,
`ScoutedTarget`), `POST /api/targets/discover`, the EDGAR flywheel
`/api/cron/intelligence` + `lib/ai/intelligence-pipeline.ts`,
`generate_signal_matches` + `org_profile_embeddings` + `match_scoring_weights`,
`lib/queries/match-inbox.ts`, `lib/actions/matches.ts`.

**Add / extend.**

- `lib/actions/sourcing-brief.ts` — `saveSourcingBrief` / `getSourcingBrief`:
  persist the operator's standing thesis/filters.
- Additive table `sourcing_briefs { id, org_id, thesis, filters jsonb, cadence,
active, created_at }` — RLS org-scoped (additive + idempotent migration).
- Extend `/api/cron/intelligence` (or a sibling cron) to, per active brief:
  call `discoverTargets` + pull matched EDGAR signals, upsert ranked candidates
  into the match-inbox pipeline, and `assignTask` + `runTask` a `deal-sourcer`
  proposal ("Review N new on-thesis targets") into the Action Queue (P1-A).
- Surface the brief editor on `app/source/pipeline` (or `leads`), reusing
  existing Source UI.

**Data model.** `sourcing_briefs` (new, additive). Candidates reuse the existing
match/pipeline tables — no new candidate table.

**Monetization (D4).** Already metered (`target_discovery`); add a
`sourcing_brief_run` meter per scheduled batch.

**Acceptance.** A saved brief produces ranked candidates in `/match-inbox` with
fit rationale + routed specialist; a batch raises exactly one Action Queue
proposal; accept/dismiss re-weights the scorer (`match_scoring_weights`); no
fabricated candidates when `ANTHROPIC_API_KEY` absent (`configured:false`); CI
green.

---

### P1-C — Diligence → Memo: orchestrator output becomes an IC-ready memo

**Goal.** Wire the existing 7-agent diligence orchestrator to a **Memo &
Scorecard** step that composes a versioned, citable IC memo into the deal's data
room.

**Builds on.** `lib/diligence/orchestrator.ts` (`runDiligence`),
`diligence_runs`, `POST /api/diligence`, `lib/ai/material-review.ts`
(reasoning-tier verdict/score/strengths/gaps), `lib/ai/diligence-qa.ts`,
`lib/queries/diligence.ts`, `lib/actions/materials.ts`, `app/build/data-room`,
`knowledge_chunks` (RAG provenance).

**Add / extend.**

- `lib/ai/memo-compose.ts` — `composeMemo(diligenceRunId)`: assemble the
  diligence findings + `material-review` scorecard into a structured memo
  (thesis, financials, risks, scorecard, recommendation) with source citations
  drawn from the run's actual lanes (reuse the `drewOn` allowlist pattern in
  `diligence-qa.ts`/`lp-answer.ts` so no lane can be hallucinated). Reasoning
  tier (`AI_MODELS.reasoning`), never-block.
- `lib/actions/memo.ts` — `generateMemo`: server action that runs
  `composeMemo`, writes a versioned document via the data-room/materials path,
  and attaches it as Chain-of-Trust **Proof-of-Concept** evidence.
- Register the `executive-advisor`/`deal-sourcer` memo executor in
  `lib/agents/executors.ts` (P1-A) so "Draft memo" flows through the Action
  Queue.
- "Draft memo" entry point on the deal/diligence surface
  (`app/run/diligence`).

**Data model.** Reuse `diligence_runs`, the data-room/materials document tables,
and `trust_events`. (Optional additive: `memo_version` column on the materials
row if versioning needs a discriminator.)

**Monetization (D4).** Meter `diligence_run` and `memo_generate`.

**Acceptance.** A completed diligence run produces a memo + scorecard in the
data room; every claim cites a real lane (no hallucinated provenance); memo is
versioned and Chain-of-Trust stamped; degrades to a templated memo when the AI
key is absent (mirrors `templatedMaterialReview`); CI green.

---

### P1-D — Chief-of-Staff brief (read tier) on the Command Center

**Goal.** A composed morning brief that reads — never writes — and tells the
operator "what your desk did and your next decision."

**Builds on.** `app/(shell)/command-center/page.tsx`,
`lib/queries/command-center.ts`, the dashboard query layer (`majorAlerts`,
`activityFeed`, `stageKpis`), `lib/queries/action-queue.ts` (P1-A),
`lib/queries/match-inbox.ts`, the Earn dock (`EarnContextKind` includes
`'intelligence'`).

**Add / extend.**

- `lib/queries/chief-of-staff-brief.ts` — `getDailyBrief(orgId)`: compose
  (a) Action Queue items awaiting approval (P1-A), (b) top new signals/matches,
  (c) KPI deltas since last brief, (d) due/overdue items. Pure read, fail-soft,
  no LLM call required (optional Earn narration is never-block).
- `components/command-center/DailyBrief.tsx` — render the brief at the top of
  the Command Center; each line deep-links to its surface (Action Queue,
  match-inbox, deal).
- Optional: an Earn one-paragraph narration of the brief via existing
  `lib/ai/earn.ts`, strictly never-block (degrades to the structured list).

**Data model.** None — read-only composition over existing rows. (Optional
additive: `brief_last_seen_at` on a per-user settings row to compute "since last
brief"; additive if added.)

**Monetization (D4).** The brief is the **Chief-of-Staff seat** value (strategy
§4) — gate richer/narrated briefs to the paid seat; no per-run meter (read-only).

**Acceptance.** Brief renders awaiting approvals + top signals + KPI deltas +
due items, each deep-linked; zero writes; never-block if Earn narration is on;
honest empty states; CI green.

---

## 3. Sequencing & dependencies

```
P1-A  Action Queue surface + executor registry   ← spine; everything reuses it
  └─ P1-B  Sourcing brief → proposals            ← raises proposals into P1-A
  └─ P1-C  Diligence → Memo                       ← registers a P1-A executor
        └─ P1-D  Chief-of-Staff brief             ← reads P1-A queue + matches + KPIs
```

P1-A is the only hard prerequisite. P1-B and P1-C are independent of each other
and can run in parallel once P1-A lands. P1-D is last (it summarizes the others).

---

## 4. Guardrails (from strategy §8 + repo invariants)

- **Propose-only (D3):** no executor that sends, signs, moves money, or
  accepts/rejects an LP is registered in Phase 1. Approval produces a
  deliverable; consequential actions stay out of scope.
- **Never-block AI:** every agent core already degrades (`configured:false`,
  `templated*` fallbacks); preserve it on every new path.
- **On the record:** every propose/approve/reject/run completion writes
  `trust_events`; produced artifacts attach as Chain-of-Trust evidence.
- **Additive + idempotent** migrations only (`sourcing_briefs`, optional
  columns); **server actions under RLS**; service role only where already used
  (ingestion, signed URLs).
- **Frozen:** 15 brain slugs + `lib/team/*`; "specialist / executive team"
  wording; tokens-only UI; no `lib/supabase` / `proxy.ts` / middleware /
  `app/login` / lockfile churn.

---

## 5. Open questions (resolve before P1-A code)

1. **Action Queue home:** dedicated `app/(shell)/action-queue` route, or fold
   into the existing Team-tasks board on Command Center? (Recommend: dedicated
   route + a brief widget on Command Center that links to it.)
2. **Executor breadth in P1-A:** ship the executor registry with only the
   sourcing executor wired (memo/diligence follow in P1-C), or stub all three?
   (Recommend: ship the registry + sourcing executor; P1-C adds memo.)
3. **Sourcing cadence:** reuse the existing 6-hour intelligence cron, or a
   separate per-brief schedule? (Recommend: reuse the existing cron first.)
4. **Memo storage:** new versioned materials row vs. data-room document — which
   table owns the memo artifact? (Confirm against `lib/actions/materials.ts`.)
   </content>
