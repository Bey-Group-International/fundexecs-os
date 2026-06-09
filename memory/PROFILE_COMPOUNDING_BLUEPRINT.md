# Profile Compounding Blueprint — the full wizard loop

The Profile is a ladder a member climbs, where each rung compounds the value of
the last (`lib/proof-of-truth/tiers.ts`). The first slice shipped in the
readiness-ladder PR: the four-rung tier engine, gated rungs, the
`institutionalReady` capstone, `ProfileLadder` on `/profile` + the wizard, a
basic "next gap" jump, and gap deep-links.

This blueprint is the plan for the **full** compounding loop, built in five
incremental, independently-shippable phases on top of that foundation. Each
phase keeps the never-block / degrade-gracefully posture and is covered by
`tiers.test.ts`.

## The five gaps between "slice" and "full loop"

| #   | Today                                                                                         | Full compounding loop                                                |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | ✅ **Shipped** — depth scoring (`scoreDepth`) across field types: numbers, specificity, proof | —                                                                    |
| 2   | Wizard pages linearly; remaining gap = the guided one-question flow (Phase 3)                  | **Single highest-value question** served at a time                   |
| 3   | ✅ **Shipped** — impact-ranked next-best gap (`rankedOpenGaps` + `compareGaps`) + skip loop    | —                                                                    |
| 4   | ✅ **Shipped** — publish persists the honest `completion_pct` (`ladder.overallPct`)            | —                                                                    |
| 5   | Ladder is private to the member                                                               | **Compounding payoff surfaced**: "Mandate complete → matchable to N" |

## Phase 1 — Depth scoring (completed in the readiness-ladder PR)

**Status:** Implemented as the baseline in the readiness-ladder PR — `scoreDepth`
is live and feeds both the ladder and the wizard scoring.

**Implemented design — `scoreDepth(q, value): { present, weak }` in `tiers.ts`**
(replaces `isWeakText`, keeps the `{ present, weak }` unit `buildLadder` already consumes):

- **tags:** present when ≥1 chip; thin when exactly 1 — a single sector/service
  barely signals a mandate.
- **numeric text** (`expects: 'number'` on check_size / raising): thin unless the
  answer carries an actual figure (a digit).
- **prose** (`textarea`): strong only when it clears the length floor **and**
  shows specificity (a number or a second sentence). A single vague line reads
  thin.
- **short structured text / select / url:** present is enough.
- Deterministic and local — no AI call on the scoring path, so the ladder stays
  instant and free.

**Files:** `lib/proof-of-truth/tiers.ts` (`scoreDepth`, sentence/number helpers),
`lib/proof-of-truth/questions.ts` (`expects` flag on numeric fields),
`components/proof-of-truth/profile-mapping.ts` (`scoreAnswer`),
`lib/queries/fund-profile.ts` (server scoring block), `tiers.test.ts`.

## Phase 2 — Next-best-question ranking ✅ shipped

**Problem:** the old `nextGapIndex` walked schema order, so it could send someone
to a low-value field before a thesis.

**Delivered:** `impactWeight(q)` (override `impact?: 1 | 2 | 3`, else by rung —
evidence 3, mandate 2, identity 1) and a shared `compareGaps` comparator in
`tiers.ts`, ordering by `tierOrder` (climb gating) → impact → severity (missing
before thin). `nextGapIndex` was replaced by `rankedOpenGaps`, and
`fund-profile.ts` reuses the same comparator, so `/profile` and the wizard serve
the identical next-best question. `headline` and `objective` carry impact
overrides.

**Never-stuck / skip loop (shipped with Phase 2):** a member can never be
trapped on a screen. Any unanswered question shows **"Skip for now"**, which
parks it (`skipped` state) and drives on to the next-best open gap — the field
stays an open gap on the record and in Review, so skip always means "come back
later", never "lose it". The old disabled-`Next` dead-end on required questions
is gone.

## Phase 3 — True one-question-at-a-time wizard

**Problem:** the flow still pages linearly; answered fields reappear on Back/Next.

**Design (additive mode, not a rewrite):** add `mode: 'guided' | 'linear'` to
`ProofOfTruthFlow`. Default **guided** on resume / "close gap" entry; **linear**
for true first-run so a first-timer still sees the full arc. Guided mode drives
the index off `rankedGaps`, auto-advances on approve, shows the
"Institutionally ready" capstone at zero gaps, and keeps a visited-stack so Back
stays navigable.

## Phase 4 — Persist the real ladder ✅ shipped

**Problem:** `answersToProfileInput` hardcoded `completionPct: 100`, so the DB and
the Settings "Proof of Truth" % always read 100 regardless of what was actually
strong.

**Delivered:** publish now writes `completionPct = ladder.overallPct` (the
depth-weighted score), so `member_profiles.completion_pct` — surfaced on
`/settings` and the trust surface — tells the truth.

**Deliberately NOT done:** the original sketch tied `status` to
`institutionalReady`. That would have **trapped** members — `middleware.ts` uses
`member_profiles.status === 'complete'` as the onboarding gate, force-redirecting
anything else back to `/onboarding` on every route. Publishing keeps
`status: 'complete'` (onboarding is done the moment they publish); readiness is
carried by the honest `completion_pct`, never by the gate. No `details.__ladder`
stash either — the dashboard/hero already recompute the ladder server-side via
`getFundProfile`, so persisting it would only risk going stale.

## Phase 5 — Surface the compounding payoff

**Problem:** climbing a rung has no felt consequence — the "multiply value" is
invisible.

**Design:** when a rung flips complete, show a one-line payoff in `ProfileLadder`
/ the wizard capstone — Mandate → "You're now matchable" (+ a live count of
matchable LP mandates from the existing matching layer, fail-open); Evidence →
"Diligence-ready". The embedding refresh already fires on save
(`lib/ai/profile-embedding.ts`); this just reads the matching count.

## Sequencing

1. ~~**Phase 1 — depth scoring**~~ ✅ shipped — makes the ladder honest.
2. ~~**Phase 2 — ranking**~~ ✅ shipped — incl. the never-stuck / skip loop.
3. ~~**Phase 4 — persist**~~ ✅ shipped — honest `completion_pct` on publish.
4. **Phase 3 — guided wizard** (build on `rankedOpenGaps` + the skip stack).
5. **Phase 5 — payoff** (polish; own PR).
