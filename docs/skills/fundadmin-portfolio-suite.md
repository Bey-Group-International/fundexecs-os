# Phase 4–5 Skills: Fund Administration + Portfolio Operations

**Status:** Landed, additive. Six new governed, deterministic skills — built **in
parallel** (six backend subagents), integrated + verified centrally. Registry now
holds **16 skills**; the generalized `catalog-consistency.test.ts` auto-covers
every one.

---

## Phase 4 — Fund administration (Fund Admin) — prepare-only

Each prepares work for review and **never** posts, closes, moves capital, or
approves NAV — those are Tier-3 human actions the manifests prohibit.

|     Skill      |                                          Prepares                                          |                                                             Guards                                                             |
|----------------|--------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| `reconcile`    | Account/GL reconciliation: statement↔ledger difference, break detection, unexplained total | requires both balances (else difference null + flagged); never posts entries                                                   |
| `nav-review`   | NAV roll-forward tie-out (prior NAV + signed flows → computed NAV vs reported)             | prior NAV is the anchor (missing → null, never assumed 0); absent flows default 0 but labelled assumptions; never approves NAV |
| `close-period` | Period-close readiness checklist (8 canonical tasks) + readiness %                         | closing/locking the period is Tier-3 human — prohibited; only prepares                                                         |

## Phase 5 — Portfolio operations (Portfolio Ops)

|       Skill        |                                             Computes                                             |
|--------------------|--------------------------------------------------------------------------------------------------|
| `portfolio-review` | Budget-to-actual revenue/EBITDA variance + covenant checks (min/max) → breaches                  |
| `value-creation`   | EBITDA bridge (current → initiatives → bridged), gap-to-target, ranked initiatives, 100-day plan |
| `kpi-ingest`       | KPI normalization vs target → variance + on/off-track status, missing-value flags                |

All deterministic, provenance-labelled (facts / assumptions / calculations /
generated), and never fabricate a figure — a missing input is flagged.

## Integration

Each skill is registered in `lib/skills/registry.ts` and permitted by the
executive whose `allowedSkills` already anticipated its id (Fund Admin for the
first three; Portfolio Ops for the last three). No wiring changes — the runtime,
session-attached runner, and "Skills at work" evidence panel already handle any
registered skill. The generalized consistency test now asserts manifest ≡ on-disk
schemas, permitted executives, and valid tier for **all 16** skills.

## Verification

78 new tests; full suite **3308 green**, typecheck + eslint clean. Pure backend —
no `app/` or `components/` changes.

## Skill catalog (16)

Deal: `screen-deal`, `returns`, `dd-checklist`, `ic-memo`.
Financial: `comps`, `dcf`, `unit-economics`.
Capital/LP: `capital-call`, `lp-update`, `distribution-notice`.
Fund admin: `reconcile`, `nav-review`, `close-period`.
Portfolio: `portfolio-review`, `value-creation`, `kpi-ingest`.

## Remaining backlog (documented)

Mid-loop engine auto-invocation (structured mandate-criteria/deal-field plumbing),
artifact DOCX/PDF phase 2, inference-gateway `inference_runs` ledger + routing
`lib/claude.ts` through it, and remaining sourcing/build/compliance skills
(`source-deals`, `buyer-list`, `kyc-screen`, `market-map`, `teaser`, `cim`, …).
