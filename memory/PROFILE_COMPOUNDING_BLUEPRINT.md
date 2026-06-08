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

| # | Today | Full compounding loop |
|---|---|---|
| 1 | Quality = presence + weak/strong on prose only (40-char rule) | **Depth scoring** across field types — numbers, specificity, proof |
| 2 | Wizard is still linear paging with a "next gap" augment | **Single highest-value question** served at a time |
| 3 | `nextGapIndex` = forward scan in schema order | **Impact-ranked** next-best-question (tier × counterparty weight) |
| 4 | `completion_pct` written as hardcoded 100 on save | Persist the **real ladder score** + per-rung state |
| 5 | Ladder is private to the member | **Compounding payoff surfaced**: "Mandate complete → matchable to N" |

## Phase 1 — Depth scoring (quality-weighted, not presence-weighted)

**Problem:** `check_size: "varies"` scores the same as `"$250K–$2M"`; only
`textarea` can read "weak".

**Design — `scoreDepth(q, value): { present, weak }` in `tiers.ts`** (replaces
`isWeakText`, keeps the `{ present, weak }` unit `buildLadder` already consumes):
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

## Phase 2 — Next-best-question ranking

**Problem:** `nextGapIndex` walks schema order, so it can send someone to a
low-value field before a thesis.

**Design — `rankedGaps(memberType, scored)` in `tiers.ts`:** sort by
`tierOrder` (climb gating) → `impactWeight` (per-question; default by tier:
evidence 3, mandate 2, identity 1) → severity (missing before weak). Add an
optional `impact?: 1 | 2 | 3` to `ProfileQuestion` for hand-tuned overrides
(thesis = 3). `nextGapIndex` becomes "first ranked gap not yet strong";
`fund-profile.ts` reuses the same comparator so `/profile` and the wizard agree.

## Phase 3 — True one-question-at-a-time wizard

**Problem:** the flow still pages linearly; answered fields reappear on Back/Next.

**Design (additive mode, not a rewrite):** add `mode: 'guided' | 'linear'` to
`ProofOfTruthFlow`. Default **guided** on resume / "close gap" entry; **linear**
for true first-run so a first-timer still sees the full arc. Guided mode drives
the index off `rankedGaps`, auto-advances on approve, shows the
"Institutionally ready" capstone at zero gaps, and keeps a visited-stack so Back
stays navigable.

## Phase 4 — Persist the real ladder

**Problem:** `answersToProfileInput` hardcodes `completionPct: 100`; the DB never
reflects partial readiness.

**Design:** compute the ladder at save time; write
`completion_pct = ladder.overallPct` and
`status = ladder.institutionalReady ? 'complete' : 'in_progress'`. Optionally
stash `details.__ladder = { readinessTierId, overallPct }` (no migration) so the
dashboard rail can read achieved readiness without recomputing.

## Phase 5 — Surface the compounding payoff

**Problem:** climbing a rung has no felt consequence — the "multiply value" is
invisible.

**Design:** when a rung flips complete, show a one-line payoff in `ProfileLadder`
/ the wizard capstone — Mandate → "You're now matchable" (+ a live count of
matchable LP mandates from the existing matching layer, fail-open); Evidence →
"Diligence-ready". The embedding refresh already fires on save
(`lib/ai/profile-embedding.ts`); this just reads the matching count.

## Sequencing

1. **Phase 1 — depth scoring** (lowest risk, makes the ladder honest). **First.**
2. **Phase 2 — ranking** (small, unlocks Phase 3).
3. **Phase 4 — persist** (small, independent; can land with 1–2).
4. **Phase 3 — guided wizard** (the big behavioral change; own PR).
5. **Phase 5 — payoff** (polish; own PR).
