# Phase 2–3 Skills: Financial Analysis + Capital/LP Operations

**Status:** Landed, additive. Six new governed, deterministic skills — built **in
parallel** (six backend subagents, one per skill), integrated + verified
centrally. Registry now holds **10 skills**; the generalized
`catalog-consistency.test.ts` auto-covers every one.

---

## New skills

All follow the `screen-deal` template (package under `/skills/<id>/` + a pure
deterministic core + golden tests). None invents a value — missing inputs are
flagged; `sources` separate facts / assumptions / calculations / generated.

### Phase 2 — Financial analysis (Analyst)

|      Skill       |                                                Computes                                                |                                                          Guards                                                           |
|------------------|--------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------|
| `comps`          | Comparable multiples (EV/EBITDA, EV/Rev, P/E) → count/median/mean/min/max; implied EV + equity + range | null when a subject metric or multiple has no data; flags a thin (<3) comp set                                            |
| `dcf`            | Projected FCF, PV, terminal value, EV, equity, per-share + WACC/terminal sensitivities                 | requires baseFcf + discountRate; **hard guard: discount rate must exceed terminal growth**; defaults labelled assumptions |
| `unit-economics` | LTV, LTV/CAC, payback months, health band                                                              | requires arpu/cac/margin/churn; divide-by-zero (churn 0) guarded → LTV undefined                                          |

### Phase 3 — Capital & LP operations (Investor Relations) — **draft-only**

|         Skill         |                                      Prepares                                      |                                                        Never                                                        |
|-----------------------|------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| `capital-call`        | A capital-call **notice draft** (amount = commitment × call %, a calculation)      | moves capital or fabricates wiring details — issuing the call is Tier-3 human; wiring is always an open placeholder |
| `lp-update`           | A quarterly LP **update draft** (performance lists only *stated* NAV/DPI/TVPI/IRR) | invents a metric — a missing metric is "Pending — confirm from fund admin"; external send is Tier-2 human           |
| `distribution-notice` | A distribution **notice draft** (amount, type, record/payment dates)               | fabricates amounts/dates — missing → open item; capital movement is Tier-3 human                                    |

The three capital/LP skills are **Tier-1 preparation** skills: they draft, they
never send or move money. Their manifests prohibit the corresponding Tier-2/Tier-3
actions, and the runtime + executive ceilings enforce it.

## Integration

Each skill is registered in `lib/skills/registry.ts` and permitted by the
executive whose `allowedSkills` already anticipated its id (Analyst for the
financial three; Investor Relations for the capital/LP three). The runtime,
session-attached runner, and "Skills at work" evidence panel already handle any
registered skill — no wiring changes needed beyond the registry.

## Verification

~91 new tests across the six skills + the generalized consistency test (which now
asserts manifest ≡ on-disk schemas, permitted executives, and valid tier for all
10 skills). Full suite **3230 green**, typecheck + eslint clean. Pure backend —
no `app/` or `components/` changes.

## Remaining backlog (documented elsewhere)

Mid-loop engine auto-invocation (needs structured mandate-criteria/deal-field
plumbing), artifact DOCX/PDF phase 2, inference-gateway `inference_runs` ledger +
routing `lib/claude.ts` through it, and the Priority-4/5 fund-admin + portfolio
skills (`reconcile`, `nav-review`, `portfolio-review`, `value-creation`, …).
