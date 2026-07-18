# Native Skill System + Operational Executive Team

**Status:** Phase-1 kernel seed landed — the native skill runtime, the operational
executive capability registry, and one reference skill (`screen-deal`) wired
through the existing gates/audit, with `skill_runs` persistence. Additive,
tested, no engine changes.
**Scope principle:** smallest coherent production-grade unit. This is the backbone
the rest of the master program (Phases 2–6) hangs off; it does not rebuild the
Earn engine, gates, mandates, artifacts, or audit — it consumes them.

---

## 1. Feature-state matrix (the pieces this program needs)

| Capability | State | Evidence |
|---|---|---|
| Earn orchestrator / workflow engine / task graph | **ACTIVE** | `lib/engine.ts`, `lib/claude.ts` (plan → parent/child `tasks`) |
| Agent registry (15 execution agents) | **ACTIVE** | `lib/agents.ts` (`AgentKey`) |
| Approval gates (Tier 1/2/3) | **ACTIVE** | `lib/gates.ts` + `approvals` table |
| Mandates / autonomy | **ACTIVE** | `lib/mandates.ts`, `lib/autonomy.ts` |
| Artifacts + provenance + immutable audit | **ACTIVE** | `artifacts`, `attestations`, `audit_log`, `brain_runs` |
| **Native skill runtime (versioned packages, I/O schemas, policy, evaluation)** | **ABSENT → BUILT (seed)** | no `/skills`, `skill.yaml`, `skill_runs` existed — this increment adds them |
| **Operational executive team (IC / Risk & Compliance / Legal & Closing; bounded domains, ceilings, prohibited actions)** | **ABSENT → BUILT** | roster was 15 marketing-leaning agents; `lib/executive-team.ts` was an unreconciled parallel vocab |
| Provider-agnostic inference gateway | **ABSENT / cosmetic** | all calls go through `lib/anthropic-client.ts`; "model switching" only injects a persona hint (`lib/earn-conversation.ts`) |
| Artifact formats DOCX/PDF/PPTX | **ABSENT** | markdown/text only; `lib/xlsx.ts` is a *reader*; no gen libs in `package.json` |
| **Phase-0 "invented metrics"** | **DEFECT — OUTSTANDING** | `app/page.tsx:141-158` hard-codes "$2B+ deal flow tracked" (invented AUM) + `StatCounter`s render **0** on first paint; fabricated testimonial `:160-165` |

## 2. Gap analysis

The execution *substrate* (engine, gates, mandates, artifacts, audit, sessions) is
mature and reusable. The missing backbone was a **governed, reusable, testable
unit of work** — a skill — and a **governance model for who may run it**. Today a
prompt becomes free-text steps (`lib/claude.ts`) dispatched by intent
(`lib/tool-dispatch.ts`); nothing declares its inputs/outputs, approval tier, or
the executive allowed to run it, and nothing persists a validated, provenanced
*skill run*. That is the gap this increment closes.

## 3. Target architecture (this slice)

```
  Objective ── Earn (lib/engine.ts, unchanged) ── assigns Executive + Skill
                                   │
                                   ▼
        ┌──────────────── lib/skills/runner.ts ────────────────┐
        │  authorize (executive may run skill?)                │  ← lib/executives/registry.ts
        │  validate INPUT  (lib/skills/validate.ts)            │  ← /skills/<id>/input.schema.json
        │  run deterministic CORE (lib/skills/catalog/*)       │  ← facts / assumptions / calculations
        │  validate OUTPUT                                     │  ← /skills/<id>/output.schema.json
        │  resolve approval tier (lib/gates.ts)               │  ← Tier 3 never delegable
        │  persist skill_run + audit event                    │  ← skill_runs, audit_log
        └──────────────────────────────────────────────────────┘
                                   ▼
                    SkillResult { structured, sources, confidence,
                      completeness, missingData, approvalTier, requiresApproval }
```

**Boundary discipline:** `executeSkillCore` is pure (no I/O) → the whole
governance path is unit-tested without a DB. `runSkill` adds persistence + audit.
A skill's domain core is pure and separately tested against golden fixtures.

## 4. Schemas (delivered)

- **Skill package** (`/skills/<id>/`): `SKILL.md`, `skill.yaml`, `policy.yaml`,
  `evaluation.yaml`, `input.schema.json`, `output.schema.json`, `examples/`. The
  machine-readable manifest is the TypeScript `SkillDefinition`
  (`lib/skills/catalog/<id>.ts`); a test (`skill-package.test.ts`) asserts the TS
  manifest and the on-disk JSON schemas never drift.
- **Skill manifest** (`lib/skills/types.ts` `SkillManifest`): id, version, hub,
  applicable executives, entity types, required/optional inputs, outputs, artifact
  types, data permissions, tools, **approval tier**, risk, timeout, retry policy,
  validation rules, evaluation criteria, provider capabilities, allowed downstream
  skills, prohibited actions, input/output JSON schema.
- **Executive** (`lib/executives/registry.ts` `ExecutiveDefinition`): key, backing
  `AgentKey`, hub, domain, **allowed skills**, data scopes, **approval ceiling**,
  **prohibited actions** (+ capabilities), handoff, review standard.
- **Approval policy:** reuses `lib/gates.ts` unchanged. A skill declares its tier;
  the runner escalates when the executive's ceiling can't cover it; **Tier 3 is
  never delegable** (`canExecutiveActAt` returns false for tier 3 for every
  executive — test-enforced).
- **Persistence:** `skill_runs` (migration `20260718140000_skill_runs.sql`) —
  org-scoped, canonical RLS, realtime; links session + workflow task; stores
  validated input/output, `sources` (fact/assumption/calculation/generated),
  missing data, validation, approval tier, provider/model, artifact.

## 5. Executive team restructure (delivered)

`lib/executives/registry.ts` maps the roster to **bounded operational domains**,
keyed to the existing `AgentKey` execution spine (no new execution taxonomy, no
enum/type churn), and **activates the missing roles** — Investment Committee, Risk
& Compliance, Legal & Closing — each backed by an execution agent. Each executive
carries an approval ceiling (≤ 2), prohibited actions, allowed skills, data scope,
handoff rules, and a review standard. This reconciles the previously-unmoored
`lib/executive-team.ts` vocabulary into one operational model the skill runtime
consumes.

## 6. Reference skill: `screen-deal` (delivered)

Deterministic core that screens an opportunity against a mandate → `pass/watch/fail`
with mandate-fit dimensions, a computed EV/EBITDA multiple (a *calculation*, never
a fact), an explicitly-labelled leverage *assumption*, key risks, **flagged
missing fields (never invented)**, diligence priorities, and a recommended next
action. Golden evaluation fixtures in `skills/screen-deal/evaluation.yaml`,
executed by the core test.

## 7. Test plan (delivered)

31 unit tests (full suite 3062 green, no regressions): validator (types, required,
enum, min/max, arrays, unknown-keyword tolerance, never-throws); executive registry
(activated roles, backing-agent integrity, Tier-3 non-delegability, ceilings, skill
permissions, prohibited actions); `screen-deal` golden cases (pass/watch/fail,
missing-data-flagged-not-invented, assumptions labelled, valuation math, unknowns
not penalised as misses); runner governance (authorize → validate → run → validate
→ tier); package consistency (TS manifest ≡ on-disk schemas; example validates).

## 8. Phased backlog (next units, with acceptance criteria)

Rollbacks are trivial — the migration is additive/idempotent and every module is
new; nothing existing was modified.

1. **Provider-agnostic inference gateway** (a master-prompt non-negotiable).
   Objective: capability-based routing so a skill/step requests a capability, not a
   model. Reuse: `lib/brains/llm.ts complete()` as the seam; the `lib/providers/`
   adapter pattern. Files: new `lib/inference/*` (interface, registry, Anthropic
   adapter), route `lib/claude.ts` call sites through it, record provider/model on
   `skill_runs` (columns already present). Accept: swapping providers needs no
   skill change; every model call logs provider/model/tokens/latency; Anthropic
   stays default; deterministic fallback preserved.
2. **Skill ↔ engine wiring.** Objective: let an Earn step invoke a skill via the
   registry instead of free-text. Reuse: `lib/tool-dispatch.ts`, `lib/engine.ts`
   `executeWorkflow`. Accept: a planned step maps to a `skillId`, runs through
   `runSkill`, attaches the `skill_run` + artifact to the workflow, and gates the
   follow-on. Guard behind a flag; do not destabilise the sacred loop.
3. **Priority-1 deal skills:** `returns` (LBO/IRR/MOIC), `dd-checklist`, `dd-prep`,
   `ic-memo`. Each: package + deterministic core + golden fixtures + executive
   binding. Accept the section-22 end-to-end: teaser → screen → returns → checklist
   → IC pre-read, all persisted + provenanced, external comms gated.
4. **Artifact engine formats.** Objective: DOCX/PDF/PPTX for IC memos/reports.
   Reuse: `artifacts` table (add enum values), skill `artifactTypes`. Accept: a
   skill emits a downloadable artifact with retained version + source refs.
5. **Session workspace evidence.** Objective: render live `skill_runs` + validation
   + sources in the split-pane so work is visibly, testably happening (not agent
   theater). Reuse: realtime on `skill_runs`, `components/session/*`.
6. **Phase-0 stabilization (OUTSTANDING non-negotiable).** Remove the invented
   "$2B+ deal flow tracked" figure + fabricated testimonial (`app/page.tsx:141-165`)
   and make counters show only verifiable values, never 0-on-hydration
   (`components/marketing/StatCounter.tsx`). Small, safe; do next.

## 9. Non-negotiables honoured by this slice

No agent theater — a skill run is a validated, persisted, audited record, not
generated text. No invented financial values — missing data is flagged, assumptions
and calculations are labelled and separated. No Tier-3 self-approval — structurally
impossible for any executive. No engine/gate bypass — the runtime consumes
`lib/gates.ts`. Existing behavior preserved — purely additive; 3062 tests green.
Provider-agnostic path opened (gateway is backlog item 1). Mobile-safe — no UI
changes in this slice.
