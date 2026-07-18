# Legal & Closing + Capital Formation + Communications Skills

**Status:** Landed, additive. Six new governed, deterministic skills — built **in
parallel** (six backend subagents), integrated + verified centrally. Registry now
holds **28 skills**; the generalized `catalog-consistency.test.ts` auto-covers
every one.

This batch was chosen to **activate the three operational executives that had no
registered skills** — Legal & Closing, Capital Formation, and Communications — and
to give Investor Relations the `investor-profile` its `allowedSkills` already
anticipated. Every operational executive now has at least one native skill.

---

## Legal & Closing (`legal_closing`) — coordinate + track, never sign

Both prepare/track work for review. Neither signs, executes a document, or marks a
deal closed — signing/closing is a Tier-3 human action the manifests prohibit.

|        Skill        |                                                   Prepares                                                   |                                           Never                                            |
|---------------------|--------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| `closing-checklist` | 8 canonical closing tasks (3 critical) merged with supplied completion status → readiness % + blocking items | signs, executes, or auto-closes — always routes to a human for final closing authorization |
| `deal-tracker`      | Rolls a supplied milestone set into status counts, at-risk items, overall status, next actions               | fabricates milestones — an empty set returns an empty tracker with a note                  |

## Capital Formation (`capital_formation`) + IR — profile, pipeline, track

None binds capital, issues a capital call, or moves money — those are prohibited.

|        Skill         |                                                   Computes                                                   |                                                     Never                                                     |
|----------------------|--------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| `investor-profile`   | Structures a supplied LP's facts, scores fit (ticket/sector/geography) against fund criteria, flags gaps     | invents AUM, wealth, mandate, PEP status, or preferences — missing fields are flagged                         |
| `raise-pipeline`     | Aggregates supplied prospects by raise stage → probability-weighted expected commitments, coverage vs target | fabricates prospects/commitments — weighting is a labelled calculation; a target with no prospects is flagged |
| `commitment-tracker` | Tracks supplied commitments vs target close: total committed, remaining, per-investor %, over-subscription   | binds capital or calls capital — it tracks supplied records; a missing amount is flagged, never assumed 0     |

## Communications (`communications`) — draft-only

|  Skill   |                                                           Assembles                                                           |                                                                        Never                                                                        |
|----------|-------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|
| `teaser` | A one-page anonymized deal teaser **draft** from supplied facts; connective prose labelled `generated`, every figure a `fact` | invents a financial figure or distributes — with no financials supplied the section is a flagged placeholder, and distribution stays a gated action |

The teaser guardrail is load-bearing and directly tested: with no revenue/EBITDA
supplied, the `financialHighlights` section is a `placeholder` and **no `fact`
source carries any invented number** — an invented figure cannot slip through.

## Epistemics (every skill)

Supplied fields are `fact` sources; derived figures (readiness %, fit score,
weighted expected, per-investor %, completion %) are `calculation` sources;
defaulted values (a milestone's absent status, a prospect's stage-default
probability) are `assumption` sources — never facts. Nothing is fabricated; a
missing input is flagged.

## Integration

Each skill is registered in `lib/skills/registry.ts` and permitted by the
executive whose `allowedSkills` already anticipated its id (Legal & Closing,
Capital Formation, Investor Relations, Communications). No wiring changes beyond
registration — the runtime, session-attached runner, and "Skills at work" evidence
panel already handle any registered skill. The generalized consistency test now
asserts manifest ≡ on-disk schemas, permitted executives, and valid tier for
**all 28** skills.

## Verification

72 new golden tests (plus 30 auto-generated consistency assertions); full suite
**3501 green**, typecheck + eslint clean. Pure backend — no `app/` or
`components/` changes.

## Skill catalog (28)

Deal: `screen-deal`, `returns`, `dd-checklist`, `ic-memo` · Financial: `comps`,
`dcf`, `unit-economics` · Capital/LP: `capital-call`, `lp-update`,
`distribution-notice` · Fund admin: `reconcile`, `nav-review`, `close-period` ·
Portfolio: `portfolio-review`, `value-creation`, `kpi-ingest` · Source:
`source-deals`, `buyer-list`, `market-map` · Risk/Compliance: `kyc-screen`,
`policy-check`, `risk-register` · Legal/Closing: `closing-checklist`,
`deal-tracker` · Capital formation/IR: `investor-profile`, `raise-pipeline`,
`commitment-tracker` · Communications: `teaser`.

Every operational executive now carries at least one native skill.

## Remaining backlog (documented)

A few skills still anticipated by the executive registry but not yet built:
Analyst modeling (`lbo`, `three-statement`, `model-audit`), Diligence (`dd-prep`),
Fund Admin (`audit-statement`), Research (`sector-research`), Communications
(`cim`). Plus the standing infra items: mid-loop engine auto-invocation
(structured mandate-criteria/deal-field plumbing), artifact DOCX/PDF phase 2, and
the inference-gateway `inference_runs` ledger + routing `lib/claude.ts` through it.
