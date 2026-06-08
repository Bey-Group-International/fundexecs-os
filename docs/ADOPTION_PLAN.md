# Adoption Plan — what to borrow from OpenVC, Raises, StartEngine, AngelList, Avestor

> Functionality + visual refinement plan. Sources studied: **OpenVC**
> (openvc.app), **Raises.com**, **StartEngine**, **AngelList**, **Avestor**.
> Deliverable scope for this round: **plan + recommendations** (no code yet).
> Decisions locked with the user: adopt **all four** feature workstreams; keep
> the **dark institutional app** and add a **light public-facing surface**;
> refine **all five member types** evenly.
>
> This doc maps each adoptable idea to the code that already exists, names the
> gap, and proposes a file-level plan so any later implementation PR can pick a
> workstream off the shelf. It follows the same OLD→NEW discipline as
> `docs/REFINE_PROGRESS.md` and inherits its guardrails (tokens-only UI,
> additive reads, additive+idempotent migrations, no auth/middleware/lockfile
> churn, 15 brain slugs frozen).

---

## 1. Competitive teardown (what each does best)

| Platform | What it's great at | The transferable idea |
| --- | --- | --- |
| **OpenVC** | Searchable investor directory with hard filters (stage, geo, check size, thesis); a structured "apply / one-click reach-out"; free founder tools (deck reviews, templates) used as top-of-funnel | A **filterable directory + structured apply** beats an unstructured contact list. Free utility tools drive acquisition. |
| **Raises.com** | Done-for-you raise as a **guided journey** — SPV/fund formation, investor outreach, data room, 506(b)/(c) compliance walked step by step | A **raise-setup wizard** with explicit compliance gating turns a blank page into a checklist. |
| **StartEngine** | Public **campaign pages**: live progress bar, amount raised, # investors, min check, "Invest now", reservations, social proof, KYC onboarding, secondary trading | A **public, shareable raise page** with live momentum + a commit CTA is the single highest-impact visual borrow. |
| **AngelList** | Syndicates/SPVs, **cap table**, GP↔LP deal-sharing, fund admin, clean **LP dashboards** with allocations and docs | **Syndicate deal-sharing** + a real **cap-table** view + crisp LP allocation dashboards. |
| **Avestor** | Custom-fund **LP portal**: distributions, statements, K-1/tax docs, periodic investor reporting, doc vault | **LP-portal depth** — distributions feed, statements, structured reporting beyond a generic update feed. |

Common threads worth internalizing:
- **Momentum is the hero.** Every winner foregrounds a live progress/coverage
  number with social proof (investors, commitments). FundExecs has the data
  (`RaiseProgressBar`, allocations) but only inside the dark app.
- **Structured > freeform.** Directories with filters and apply-flows convert;
  raise setup as a wizard reduces drop-off.
- **A public surface is the growth loop.** Shareable, indexable-when-wanted,
  beautiful read-only pages are how all five acquire.

---

## 2. Where FundExecs already is (so we extend, not rebuild)

| Capability | Existing code | State |
| --- | --- | --- |
| Raise progress (committed / soft / target) | `components/dashboard/RaiseProgressBar.tsx`, `lib/queries/dashboard` | ✅ in-app, dark only |
| Shareable public profile (token-gated, safe subset) | `app/p/[token]/page.tsx`, `lib/queries/public-profile.ts`, `lib/actions/profile-share.ts` | ✅ read-only, **no raise/commit, dark** |
| Capital stack / coverage | `app/capital-stack`, `components/capital-stack/CapitalStackView.tsx`, `lib/queries/capital-stack.ts` | ✅ in-app |
| Allocations | `lib/actions/allocations.ts`, `lib/queries/pipeline.ts` | ✅ |
| Match inbox (fit-scored triage) | `app/match-inbox`, `components/match-inbox/MatchInboxView.tsx`, `lib/queries/match-inbox.ts` | ✅ |
| Connections / warm intros | `app/connections`, `lib/actions/connections.ts`, `lib/queries/connections.ts` | ✅ |
| Partners / ecosystem directory | `app/partners`, `components/partners/PartnersView.tsx`, `lib/queries/partners.ts` | ✅ list, **no hard filters/apply** |
| LP room (overview, commitments, doc vault, updates, Q&A) | `components/lp-room/*` (`CommitmentTracker`, `DocumentVaultList`, `UpdateFeed`, `LpQAChat`, `FundOverviewCard`) | ✅ **no distributions/statements** |
| Payments | `lib/actions/stripe-checkout.ts` | ✅ checkout exists |
| Chain of Trust | `app/trust`, `components/shell/trust/*` | ✅ — our differentiator vs all five |

**Takeaway:** none of the four workstreams is greenfield. Each is an extension
of shipped surfaces, which keeps effort and risk low.

---

## 3. The four workstreams

### W1 — Public raise / campaign page (StartEngine)  · highest impact

**Adopt:** a public, token-gated **raise page** that shows the live progress
bar, amount committed, # of committed parties, min check, and a **"Express
interest / commit"** CTA — plus Chain-of-Trust verification as our unique
social-proof layer.

- **Build on:** `app/p/[token]/page.tsx` (already token-gated + safe-subset) and
  `RaiseProgressBar`. Add a public raise variant, e.g. `app/r/[token]/page.tsx`,
  fed by a new safe loader `lib/queries/public-raise.ts` that returns only
  non-sensitive raise fields (target, committed, coverage %, # parties, stage,
  CoT %, headline) — mirroring `getPublicProfile`'s safe-subset pattern.
- **Commit flow:** a server action `lib/actions/raise-interest.ts` that records
  an inbound "interest" (name, email, indicative amount) into a new
  `raise_interests` table → routes into `match-inbox` for the owner to triage.
  Re-use the existing `stripe-checkout` action when a raise opts into real
  reservations.
- **Member types:** primary for **startup** & **investment_firm** (raising);
  **individual_investor**/**service_provider** see it as the public face of a
  deal they're shown.
- **Visual:** **light** marketplace theme (see §5). Progress bar, big committed
  number, investor-count chip, verified-by-CoT badge, sticky commit CTA.
- **Acceptance:** revoked/expired token → graceful unavailable state (reuse
  existing pattern); zero sensitive fields in payload; commit writes an
  interest + a notification; CI green.

### W2 — Investor / capital directory + apply flow (OpenVC / AngelList)

**Adopt:** turn `partners` (and capital providers) into a **filterable
directory** — stage, sector, geo, check size, type — with a structured
**"Request intro / Apply"** action instead of a flat list.

- **Build on:** `components/partners/PartnersView.tsx` + `lib/queries/partners.ts`
  (add filter params), `lib/actions/connections.ts` (warm-intro request already
  exists — wire an "apply" that creates a `warm_introduction` + match).
- **Reuse:** the `match-inbox` fit-score visual language (`scoreMeta` tone rail)
  so directory cards scan by fit, consistent with shipped work (#110).
- **Member types:** **startup** (find capital), **investment_firm** (find
  co-investors/LPs), **service_provider** (find clients), **student** (find
  opportunities — already a list section). LPs browse deals.
- **Visual:** dark app, filter rail + result grid; reuse `Badge`, `Select`,
  tone rails. No new theme.
- **Acceptance:** filters derive from real data (no fabricated facets); apply
  creates a real intro/match row; empty/zero-result states honest; CI green.

### W3 — LP portal depth: distributions + statements + reporting (Avestor / AngelList)

**Adopt:** extend `lp-room` beyond updates/docs with a **distributions** feed,
**capital-account statements**, and periodic **investor reporting**.

- **Build on:** `components/lp-room/*`. Add `DistributionsFeed.tsx`,
  `CapitalAccountCard.tsx`; extend `CommitmentTracker` (committed → called →
  distributed → NAV). New additive tables (`distributions`,
  `capital_account_entries`) + a query `lib/queries/lp-room.ts` (currently
  fixtures-driven — `components/lp-room/fixtures.ts`).
- **Member types:** **individual_investor** (LP, primary), **investment_firm**
  (GP issues distributions/statements). Others unaffected.
- **Visual:** dark app; reuse donut/sparkline (`RingGauge`, `Sparkline`),
  tone tokens, currency `Intl` formatting (matches #104).
- **Acceptance:** statements reconcile to commitments; no fabricated balances
  (honest "no distributions yet" empty state); additive idempotent migrations;
  CI green.

### W4 — Guided raise-setup wizard + compliance gating (Raises.com)

**Adopt:** a stepper that walks an org from "no raise" → live raise: terms →
target/min → exemption (506(b)/(c)) → data room → invite/publish. 506(c) gates
the public page (W1) on accredited-investor verification.

- **Build on:** the shipped `OnboardingStepper` pattern
  (`components/onboarding/OnboardingStepper.tsx`) and `capital-stack`. New
  `app/capital-stack/setup/` (or a drawer) + `lib/actions/raise-setup.ts`.
- **Compliance:** an additive `raise_compliance` field set (exemption type,
  accreditation-required flag) that W1 reads to decide whether the public page
  shows a public commit CTA (506(c)) or a gated "request access" (506(b)).
- **Member types:** **startup**, **investment_firm** (raising). Others
  unaffected.
- **Visual:** dark app; reuse stepper + gold Earn-led surface; Earn (COO) can
  narrate each step (existing `ask-earn`).
- **Acceptance:** wizard is resumable (reuse onboarding draft pattern);
  exemption choice actually gates W1's CTA; CI green.

**Dependency order:** W4 (compliance flags) lightly feeds W1 (gating), and W2/W1
both feed `match-inbox`. Recommended sequence: **W1 → W2 → W3 → W4**, since W1
is highest-impact and self-contained, and W4's gating is additive on top.

---

## 4. Adoption matrix (one-look summary)

| # | Borrow | From | Extends | New surface/table | Effort | Impact |
| --- | --- | --- | --- | --- | --- | --- |
| W1 | Public raise page + commit | StartEngine | `app/p/[token]`, `RaiseProgressBar` | `app/r/[token]`, `raise_interests` | M | ★★★ |
| W2 | Directory filters + apply | OpenVC/AngelList | `partners`, `connections` | filter params, apply action | M | ★★ |
| W3 | Distributions + statements | Avestor/AngelList | `lp-room` | `distributions`, `capital_account_entries` | M–L | ★★ |
| W4 | Raise-setup wizard + 506 gating | Raises.com | `OnboardingStepper`, `capital-stack` | `raise-setup` action, compliance fields | M | ★★ |

---

## 5. Visual direction — dark app + new light public surface

Locked: **keep the dark institutional app** (`--bg-0 #070b14`, white-alpha
surfaces, gold = Earn) for logged-in members; introduce a **light marketplace
theme** for public, unauthenticated surfaces (the W1 raise page and, optionally,
a light refresh of `app/p/[token]`).

The token system already anticipates this — `app/globals.css` notes a future
`data-theme="light"` override at `:root`. Plan:

1. **Add a `light` token set** scoped to public routes only (a
   `data-theme="light"` wrapper or a `app/(public)` segment), not a global flip.
   Light canvas, dark text ramp, same accent/gold/azure hues retuned for
   contrast (WCAG AA, matching the a11y rigor already in `globals.css`).
2. **Keep brand continuity:** Earn coin, gold accents, the "Verified" /
   Chain-of-Trust badge carry across both themes so the public page still reads
   as FundExecs.
3. **Components stay token-driven** so the same `Card`/`Badge`/`ProgressBar`
   render correctly under either theme — no per-theme component forks.
4. **No churn to the dark app.** The light theme is additive; existing dark
   surfaces are untouched (guardrail).

This gives the StartEngine/OpenVC "bright, friendly, marketplace" feel exactly
where it helps acquisition, without destabilizing the institutional product.

---

## 6. Per-member-type touchpoints (all five, evenly)

| `member_type` | W1 raise page | W2 directory | W3 LP portal | W4 wizard |
| --- | --- | --- | --- | --- |
| `investment_firm` (GP) | Publish a deal/raise | Find LPs / co-investors | Issue distributions/statements | Set up SPV/raise |
| `individual_investor` (LP) | Commit / express interest | Browse deals & syndicates | **Primary**: account, distributions | — |
| `startup` | **Primary**: public raise | Find capital | — | **Primary**: raise setup |
| `service_provider` | Appears on deal pages | Find clients (apply) | — | — |
| `student` | View live opportunities | **Primary**: opportunities | — | — |

Every type gains at least two touchpoints, satisfying the "all five evenly"
decision.

---

## 7. Guardrails (inherited from the refinement campaign)

- One branch per workstream; **draft PR**; CI green
  (`format:check`, `typecheck`, `lint`, `build`); CodeRabbit-clean.
- **Tokens-only** UI (no inline hex); reuse `components/ui/*`.
- Reads are **additive**; migrations **additive + idempotent**, no `DROP`.
- **Never-block AI** rule holds (Earn narration degrades gracefully).
- No changes to `lib/supabase` clients, `proxy.ts`, middleware, `app/login`,
  or lockfiles. 15 brain slugs + `lib/team/*` frozen.
- Public surfaces use the **safe-subset / service-role** pattern already proven
  in `getPublicProfile` — zero sensitive fields in any public payload.

---

## 8. Decisions still needed before implementation

1. **W1 commit semantics:** soft "express interest" only (lead-gen) vs. real
   money via `stripe-checkout` reservations? (Recommend: ship interest first,
   wire reservations behind 506(c) gating in W4.)
2. **Public indexing:** keep raise pages `noindex` like `app/p/[token]`, or make
   published raises SEO-indexable for the OpenVC-style growth loop?
3. **W3 fund-admin scope:** statements/distributions as **reporting only**, or
   eventually money movement (out of scope for now)?
4. **Cap table:** is an AngelList-style cap-table view in scope, or does the
   `startup` dashboard's existing "cap table teaser" suffice for now?

Answer these and any workstream is ready to convert into an implementation PR.
