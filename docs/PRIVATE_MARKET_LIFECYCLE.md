# FundExecs OS — Private-Market Lifecycle & Build Direction

The intentional spec for adopting the prototype's IA onto the live stack. **No
cosmetic buttons** — every module maps to a stage of the emerging-manager
capital-formation lifecycle, runs real logic over real Supabase data, and is
guided by Earn (COO). Adoption decision: **IA + UX onto the real stack**, reuse
what exists, back everything with data. Order: **Shell → Revenue → Intel/Audit.**

---

## 1. The lifecycle (why each module exists)

An emerging manager becomes institutional by moving through a compounding loop.
FundExecs OS instruments every stage and lets Earn drive the next move.

| #   | Lifecycle stage            | Manager's real job                                   | The module that runs it                                                                  |
| --- | -------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | **Establish truth**        | Prove who you are: thesis, track record, team, terms | **Fund Profile** (Source of Truth) + **Trust Center**                                    |
| 2   | **Get raise-ready**        | Materials, governance, formation readiness           | **Fund Readiness** (gamification) + **Capital Materials Studio** + **Governance Plan**   |
| 3   | **Source LPs**             | Build & qualify a targeted LP universe               | **LP Pipeline** + **Match Inbox**                                                        |
| 4   | **Convert LPs**            | Move interest → soft-circle → commitment → close     | **Capital Stack** + **Objections** + LP Pipeline stages                                  |
| 5   | **Source & execute deals** | Find, diligence, decide, deploy                      | **Deal Desk** + **IC Memos** (diligence Synthesis) + **Governance Deployment**           |
| 6   | **Operate & leverage**     | Turn signal into action; reuse knowledge             | **Action Queue** + **Inbox Intelligence** + **Knowledge Base** + **Partner Marketplace** |
| 7   | **Prove & compound**       | Make every action auditable & reusable               | **Memory Audit Trail** + Trust Center                                                    |

**Daily loop (cuts across all stages):** Dashboard → Action Queue → Match Inbox.
That's the manager's morning: where am I, what's next, who/what just matched.

---

## 2. Module spec — intent · real logic · data · Earn

### Shell (Wave 1)

- **Dashboard (lifecycle-aware).** Intent: answer "where am I in the raise/deploy
  cycle and what moves the needle today?" Logic: compute the manager's current
  **lifecycle stage** + **readiness score** from Fund Profile completeness, Chain
  of Trust layers, pipeline state, and capital-stack progress; surface stage-
  appropriate KPIs + Earn's top 3 actions. Not a generic tile wall — the tiles
  change by stage and member type. Data: `member_profiles`, chain-of-trust,
  pipeline, allocations. Earn: narrates the stage + next best move.
- **Gamification.** Intent: progression toward _institutional readiness_, not
  vanity points. Logic: XP/levels already exist; add **streaks** (consecutive
  active days) and **milestone unlocks** tied to lifecycle gates (e.g. "Proof of
  Concept complete → LP outreach unlocked"). Reuse Chain-of-Trust XP.
- **Fund Profile (Source of Truth, side rail).** Intent: the canonical fund/
  manager record everything else reads from. Logic: thesis, strategy, target
  raise, terms, track record, team — with a **completeness/credibility score**
  that feeds Dashboard + Fund Readiness and is referenced by outreach, materials,
  IC memos. Persistent on the side rail. Data: extend `member_profiles` (reuse;
  no schema churn unless needed). Earn: fills gaps, flags weak spots an LP would
  probe.

### Revenue core (Wave 2)

- **LP Pipeline.** Stages: target → contacted → meeting → diligence → soft-circle
  → committed → closed. Reuse `/pipeline` + `/connections`. Logic: stage
  velocity, stuck-deal detection, next action per LP.
- **Match Inbox** (NEW data — Codex). Intent: a daily triage of **scored LP↔fund
  and deal↔mandate matches**. Logic: score on thesis fit, check size, geography,
  mandate, warmth; accept→creates a pipeline entry, dismiss→trains the filter.
- **Capital Stack** (NEW data — Codex). Intent: the live **capital structure** of
  the raise — target vs. soft-circled vs. committed vs. closed, by LP type/
  tranche. Logic: roll up allocations into a stack view + gap-to-close; drives
  Dashboard's raise progress.
- **Objections.** Intent: an objection **library + resolution loop** (fees, track
  record, team, strategy, timing). Logic: log objections per LP, attach Earn's
  rebuttal, track resolved/open, correlate to conversion. Reuse the Objection
  Assistant.
- **Deal Desk.** Intent: investment-opportunity pipeline (sourcing → screen →
  diligence → IC → deploy). Reuse `/pipeline` deal side + diligence.
- **IC Memos.** Intent: formal investment-committee memos = the **diligence
  Synthesis already shipped**, surfaced as a memo library tied to deals. Reuse
  `lib/diligence` + `/diligence`.
- **Governance Plan / Deployment.** Intent: the 100/30/10 objective framework
  applied to the fund and each deal. Reuse `governance_plans`/`objectives`;
  surface deployment status.

### Intelligence + Audit (Wave 3)

- **Action Queue.** Unify notifications + Earn next-best-actions into one
  prioritized, lifecycle-aware queue (do-next, not just notify).
- **Inbox Intelligence.** Extract commitments/objections/intros from Gmail +
  meeting transcripts → Action Queue items. Reuse integrations.
- **Knowledge Base.** The 15-brain RAG + `knowledge_documents`. Reuse.
- **Capital Materials Studio** (later). Generate decks/memos/one-pagers from Fund
  Profile (Canva MCP).
- **Partner Marketplace** (later). Directory of service providers / co-investors
  from `service_providers`/`capital_providers`.
- **Trust Center.** Chain of Trust / proof layers / evidence / approvals. Reuse.
- **Memory Audit Trail.** Immutable, queryable log of every Earn action, agent
  output, and decision (`admin_actions` + `trust_events` + diligence findings) —
  the institutional memory that makes the system auditable and compounding.

---

## 3. Wave plan (Shell → Revenue → Intel/Audit)

- **Wave 1 (now):** unified 6-area side rail (this IA) · lifecycle-aware Dashboard
  · Fund Profile (Source of Truth). + Codex starts **Match Inbox** & **Capital
  Stack** data models in parallel.
- **Wave 2:** LP Pipeline polish · Capital Stack UI · Match Inbox UI · Objections
  · Deal Desk · IC Memos surface · Governance.
- **Wave 3:** Action Queue · Inbox Intelligence · Knowledge Base · Materials
  Studio · Partner Marketplace · Trust Center · Memory Audit Trail.

## 4. Agent split (specialized)

- **Emergent** — UI: the unified 6-area rail + Dashboard UI + Fund Profile UI,
  binding to Claude's typed loaders (placeholder fallback until wired). **Mimic
  the prototype's dashboard layout + functionalities as closely as possible
  (high fidelity)** — same sections, ordering, card structure, and interactions —
  re-skinned to our design tokens and bound to real data. Rebase on current
  `main`. Solid `bg-bg-1` overlays; design tokens only.
- **Codex** — data: `Match Inbox` and `Capital Stack` models + RLS + any RPCs.
- **Claude** — the lifecycle **data/logic layer** (loaders, actions, stage +
  readiness computation), Earn wiring, review/merge. Owns `lib/queries/*`,
  `lib/actions/*`, types; does NOT build the Wave-1 pages/components (Emergent's).

_Maintained by Claude. Encodes the Jun-6 lifecycle adoption decision._
