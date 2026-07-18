# Source Intelligence + Risk & Compliance Skills

**Status:** Landed, additive. Six new governed, deterministic skills — built **in
parallel** (six backend subagents), integrated + verified centrally. Registry now
holds **22 skills**; the generalized `catalog-consistency.test.ts` auto-covers
every one.

---

## Source intelligence (Deal Sourcing / Research) — rank, never fabricate

The load-bearing guardrail (a master-prompt concern): these skills **rank/organize
a candidate set the caller supplies. They never invent, research, or hallucinate
companies.** With no input set they return an empty result + an explicit note.

| Skill | Executive | Does |
|---|---|---|
| `source-deals` | Deal Sourcing | Ranks supplied candidates against a mandate (sector/geo/size fit, exclusions) → top targets |
| `buyer-list` | Deal Sourcing | Ranks a supplied buyer set for a sale process (strategic/financial/sponsor, fit) |
| `market-map` | Research | Segments a supplied company set into a market map (by segment, counts) |

## Risk & Compliance (Risk & Compliance) — screen + escalate, never decide

Another master-prompt non-negotiable: these skills **support** compliance. They
screen, flag, score, and route exceptions — they **never approve onboarding, never
make the final compliance/legal determination, and never authorize an action.**

| Skill | Does | Never |
|---|---|---|
| `kyc-screen` | KYC/AML rules-grid screen: doc completeness, expiry, PEP/sanctions/failed-check escalation | approves onboarding — status is `clear_for_review`/`incomplete`/`escalate`, **never** "approved"; a compliance officer decides |
| `policy-check` | Evaluates supplied policies against a proposed action + context → ok/review/restricted | authorizes the action or makes the final call — defers to a compliance/legal officer |
| `risk-register` | Scores a supplied risk set (likelihood × impact → severity), flags gaps | fabricates risks |

## Integration

Each skill is registered in `lib/skills/registry.ts` and permitted by the
executive whose `allowedSkills` already anticipated its id (Deal Sourcing /
Research / Risk & Compliance). No wiring changes — the runtime, session-attached
runner, and "Skills at work" evidence panel already handle any registered skill.
The generalized consistency test now asserts manifest ≡ on-disk schemas, permitted
executives, and valid tier for **all 22** skills.

## Verification

91 new tests; full suite **3399 green**, typecheck + eslint clean. Pure backend —
no `app/` or `components/` changes.

## Skill catalog (22)

Deal: `screen-deal`, `returns`, `dd-checklist`, `ic-memo` · Financial: `comps`,
`dcf`, `unit-economics` · Capital/LP: `capital-call`, `lp-update`,
`distribution-notice` · Fund admin: `reconcile`, `nav-review`, `close-period` ·
Portfolio: `portfolio-review`, `value-creation`, `kpi-ingest` · Source:
`source-deals`, `buyer-list`, `market-map` · Risk/Compliance: `kyc-screen`,
`policy-check`, `risk-register`.

This covers the operational executive bench end to end (Analyst, Diligence,
Investment Committee, Investor Relations, Fund Admin, Portfolio Ops, Deal
Sourcing, Research, Risk & Compliance).

## Remaining backlog (documented)

Mid-loop engine auto-invocation (structured mandate-criteria/deal-field plumbing),
artifact DOCX/PDF phase 2, inference-gateway `inference_runs` ledger + routing
`lib/claude.ts` through it, and the few remaining build/comms skills
(`closing-checklist`, `deal-tracker`, `investor-profile`, `raise-pipeline`,
`teaser`, `cim`, `sector-research`).
