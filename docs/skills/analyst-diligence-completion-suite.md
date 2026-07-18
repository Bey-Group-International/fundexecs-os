# Analyst Modeling + Diligence + Fund-Admin + Research + Comms — Catalog Completion

**Status:** Landed, additive. Seven new governed, deterministic skills — built **in
parallel** (seven backend subagents), integrated + verified centrally. Registry now
holds **35 skills**, and **the anticipated catalog is complete**: every skill id
referenced by any executive's `allowedSkills` in `lib/executives/registry.ts` is
now backed by a real, tested skill (verified: 35 registered = 35 anticipated, 0
missing).

---

## Analyst modeling (`analyst`) — compute from supplied assumptions, never invent

| Skill | Computes | Never |
|---|---|---|
| `lbo` | LBO returns from supplied assumptions: sources & uses, exit equity, MOIC, IRR | invents an assumption — a missing required input means the affected output is `null` and flagged, never guessed |
| `three-statement` | A simplified, internally-consistent IS/CF/BS projection that **ties out** (assets = liabilities + equity) every year | fabricates a driver — the balance-sheet tie-out is the load-bearing output, `balances===true` by construction |
| `model-audit` | A rules-grid audit of a supplied model: range breaches, failed checks, implausible ratios → findings with severity | re-computes a corrected model — it flags for the analyst; no finding ever carries an invented "right" number |

The `three-statement` model is **balanced by construction**: debt is held constant,
equity rolls by net income, and the opening balance sheet is plugged (equity =
cash + NWC + PP&E − debt), so the year-over-year balance difference is invariant
and zero. A supplied-but-unbalanced opening BS is flagged, never silently adjusted.

## Diligence (`diligence`) — sequence a workplan, never diligence

| Skill | Prepares | Never |
|---|---|---|
| `dd-prep` | A sequenced, prioritized diligence workplan across 8 canonical workstreams, merging supplied known items + focus areas | performs diligence, draws conclusions, or sends a request (Tier-2) — distinct from `dd-checklist` (the request list); this is the agenda/sequencing |

## Fund administration (`fund_admin`) — tie out, never opine

| Skill | Prepares | Never |
|---|---|---|
| `audit-statement` | Audit support: ties supplied statement lines to their supporting schedules/GL → variances + unsupported items | issues an audit opinion, signs off, or posts an entry — a missing support value is `unsupported`, never assumed equal |

## Research (`research`) — organize + grade sources, never fabricate

| Skill | Organizes | Never |
|---|---|---|
| `sector-research` | A supplied research set into a sector brief by category, grades each claim's source quality, flags unsupported claims | invents facts, figures, or market data — every material claim must carry a supplied source; an unsourced claim is flagged, never emitted as a `fact` |

## Communications (`communications`) — draft-only

| Skill | Assembles | Never |
|---|---|---|
| `cim` | A Confidential Information Memorandum **draft outline** (7 sections) from supplied facts | invents a financial figure or distributes — the `financialSummary` uses only supplied figures; with none it is a flagged placeholder and no `fact` source carries an invented number (directly tested) |

## Epistemics (every skill)

Supplied fields are `fact` sources; derived figures (EV, MOIC, IRR, variances,
projected line items, source grades) are `calculation` sources; conservative
defaults (no multiple expansion, held-constant debt, the equity plug, a defaulted
materiality threshold, a template's default task status) are `assumption` sources —
never facts. Nothing is fabricated; a missing input is flagged.

## Integration

Each skill is registered in `lib/skills/registry.ts` and permitted by the
executive whose `allowedSkills` already anticipated its id (Analyst, Diligence,
Fund Admin, Research, Communications). No wiring changes beyond registration — the
runtime, session-attached runner, and "Skills at work" evidence panel already
handle any registered skill. The generalized `catalog-consistency.test.ts` now
asserts manifest ≡ on-disk schemas, permitted executives, and valid tier for
**all 35** skills.

## Verification

122 new tests; full suite **3623 green**, typecheck + eslint clean. Pure backend —
no `app/` or `components/` changes.

## Skill catalog (35) — complete

Deal: `screen-deal`, `returns`, `dd-checklist`, `ic-memo` · Analyst modeling:
`comps`, `dcf`, `unit-economics`, `lbo`, `three-statement`, `model-audit` ·
Diligence: `dd-prep` · Capital/LP: `capital-call`, `lp-update`,
`distribution-notice` · Fund admin: `reconcile`, `nav-review`, `close-period`,
`audit-statement` · Portfolio: `portfolio-review`, `value-creation`, `kpi-ingest` ·
Source: `source-deals`, `buyer-list`, `market-map` · Research: `sector-research` ·
Risk/Compliance: `kyc-screen`, `policy-check`, `risk-register` · Legal/Closing:
`closing-checklist`, `deal-tracker` · Capital formation/IR: `investor-profile`,
`raise-pipeline`, `commitment-tracker` · Communications: `teaser`, `cim`.

**Every skill id referenced by the operational executive registry is now backed by
a governed, deterministic, tested skill.** The native skill catalog is feature-complete.

## Remaining backlog (infra, documented)

With the skill catalog complete, the remaining work is infrastructural, not new
skills: mid-loop engine auto-invocation (structured mandate-criteria/deal-field
plumbing + planner step-tagging), artifact DOCX/PDF phase 2 (backend render + the
`docx` dependency), and the inference-gateway `inference_runs` telemetry ledger +
routing `lib/claude.ts` through the gateway (plus real OpenAI/Google adapters).
