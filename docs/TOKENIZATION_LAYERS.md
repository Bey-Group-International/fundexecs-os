# Tokenization Layers — Architecture & Spec

> **Status:** Design draft (Pre-Alpha). This document specifies the three-layer
> token model for FundExecs OS and how it compounds value for institutional
> users. It binds to the primitives that already exist in the codebase
> (`wallets`, `credit_ledger`, `marketplace_listings`, the closing checklist,
> and the provenance/verification system) rather than inventing parallel ones.

---

## 1. Thesis

In private markets, the scarce assets are **access, standing, and trust**. Every
incumbent tool resets these to zero: a new deal, a new counterparty, a new
close — none of your history travels with you. The institutional version of
"tokenization" is not crypto for its own sake. It is turning access, standing,
and verified outcomes into **durable, portable, auditable units** that *compound*:

> Each funded credit, each verified action, and each closed deal should make the
> **next** one cheaper, more trusted, and better-matched — never a fresh start.

We model this as three layers, each owning one scarce asset:

| Layer | Owns | Maps to (today) | Token primitive |
|-------|------|-----------------|-----------------|
| **Access** | What you can do / see | `wallets` + `credit_ledger` | **Credits** (metered, spendable) |
| **Governance** | Your standing to act in the market | `marketplace_listings` + matching | **Reputation + Stake** |
| **Security** | Whether an outcome is real | Closing checklist + `verification_status` | **Attestations + Escrow** |

The three are not independent products. They are one flywheel (§5): credits fund
activity → activity that *verifiably closes* mints reputation → reputation buys
governance standing and cheaper access → which lowers the cost of the next deal.

---

## 2. Substrate decision — hybrid (off-chain now, on-chain bridge later)

**Decision:** Build every unit on an **internal, off-chain ledger** today, but
define it through an abstraction that lets *specific* units be mirrored on-chain
later, without a rewrite.

**Why not on-chain now.** Institutions in private markets carry securities, AML/KYC,
custody, and fiduciary obligations. Putting transferable value on a public chain
pre-product invites those questions before we have a product worth regulating. The
existing `credit_ledger` is already an append-only, auditable record — that is 90%
of what "a token ledger" needs to be.

**Why not pure off-chain forever.** Some future units genuinely benefit from being
composable and transferable across counterparties — e.g. a verified closing
attestation an LP could carry to another platform, or a transferable co-invest
claim. We don't want to be re-architecting when that day comes.

### 2.1 The ledger abstraction

Every token-like unit is a **balance + an append-only movement log**, with a
`settlement` field describing where the source of truth lives:

```
Unit            Balance store         Movement log          settlement
-----           -------------         ------------          ----------
Credit          wallets.credits       credit_ledger         "internal"
Reputation      reputation_scores     reputation_ledger     "internal"
Stake           stake_positions       stake_ledger          "internal"
Attestation     attestations          (immutable rows)      "internal" | "anchored"
```

- `settlement = "internal"` → Postgres is the source of truth (today, all units).
- `settlement = "anchored"` → a hash/Merkle root of the row is committed on-chain
  for third-party verifiability, but the row stays authoritative off-chain.
- `settlement = "onchain"` (future) → the unit is a real on-chain token; Postgres
  becomes a cache/index of chain state.

This means the **on-chain bridge is a per-unit migration, not a platform rewrite.**
The first candidate to anchor is **attestations** (§4.3) — they benefit most from
third-party verifiability and carry the least regulatory weight (they assert that
something happened; they are not themselves transferable value).

---

## 3. Layer 1 — Access (Credits)

**Owns:** what an org can do and see. **Already substantially built.**

### 3.1 What exists

- `wallets(organization_id, credits, plan, plan_interval)` — per-org balance + plan.
- `credit_ledger` — append-only movements with a `reason` (`spend`, `grant`,
  `referral`, `gift`, …) and downline `level` for referral overrides.
- `increment_org_credits(p_org, p_delta)` — atomic, wallet-creating, zero-clamped RPC.
- `lib/billing.ts` — plans (`starter`/`pro`/`scale`), credit packs, and a
  **loyalty bonus by tenure** (already a compounding hook — see §5.2).

### 3.2 What the token model adds

**Entitlements, not just balance.** Today credits meter consumption (agent runs,
intel). The access layer should also gate *capability tiers* that reputation and
plan unlock — e.g. "can list in the marketplace," "can issue attestations,"
"priority match queue." Model these as derived **entitlements** computed from
`(plan, reputation_tier, stake)` rather than a hand-maintained flag column, so
they stay consistent as the other layers move.

```
entitlements(org) = grants_from(plan)
                  ∪ grants_from(reputation_tier(org))
                  ∪ grants_from(active_stake(org))
```

**Metered burn with reputation rebate.** Spend still debits credits via
`grantCredits(..., negative, "spend")`. But the **effective price** of an action
is discounted by reputation tier and loyalty (§5) — the compounding shows up as a
line item ("Verified-operator discount: −15%"), which is exactly the institutional
signal we want users to *feel*.

No schema change is required for the core of this layer — it is mostly a pricing
function and an `entitlements()` resolver over existing tables.

---

## 4. Layer 2 — Governance (Reputation + Stake)

**Owns:** your standing to act in the marketplace. **Decision: reputation-gated
tiers + stake-to-list.**

The marketplace is where quality either compounds or rots. Pure open listing rots
(spam, smoke-and-mirrors deals — the exact pain in the README). The institutional
fix is two gates that *cost something real*: a **track record** you can't fake and
a **refundable stake** you forfeit for bad-faith conduct.

### 4.1 Reputation

A portable, **earned** score per org (and optionally per principal), derived from
*verified* events — never self-asserted. Reputation is **non-transferable** and
**non-purchasable** (this is the institutional credibility guarantee).

**New table: `reputation_scores`**

```sql
create table public.reputation_scores (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  score           integer not null default 0,      -- current points
  tier            text not null default 'unranked', -- unranked|verified|established|principal
  updated_at      timestamptz not null default now()
);
```

**New table: `reputation_ledger`** (append-only, mirrors `credit_ledger`'s design)

```sql
create table public.reputation_ledger (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delta           integer not null,
  reason          text not null,   -- close_verified | vouch_received | listing_honored
                                    -- | diligence_cleared | bad_faith_penalty
  source_id       uuid,            -- the deal/listing/attestation that earned it
  note            text,
  created_at      timestamptz not null default now()
);
```

Reputation accrues from **events the system can verify** — closed deals (§4.3
attestations), diligence cleared, listings that completed honestly, vouches from
already-reputable counterparties (weighted by *their* tier, so vouches can't be
farmed). It decays slowly if inactive, so standing reflects a *live* track record.

**Tiers** unlock entitlements (§3.2): e.g. `verified` → may list; `established` →
priority match queue + lower stake; `principal` → may issue vouches and serve as
an attestation witness.

### 4.2 Stake-to-list

Listing in the marketplace requires escrowing a **refundable credit stake**. Honest
completion returns it (plus a reputation grant); bad-faith conduct (misrepresented
deal, ghosting a matched counterparty) forfeits it and applies a reputation penalty.

**New table: `stake_positions`**

```sql
create table public.stake_positions (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purpose         text not null,           -- listing | governance
  ref_id          uuid,                    -- marketplace_listings.id when purpose='listing'
  amount          integer not null check (amount > 0),  -- credits locked
  status          text not null default 'locked' check (status in ('locked','returned','forfeited')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
```

Locking a stake debits `wallets.credits` (a `credit_ledger` row, `reason='stake_lock'`)
and inserts a `stake_positions` row. Resolution returns or burns it with the
matching reverse ledger entry — so **the credit ledger remains the single source of
truth for all credit movement**, and stake is just a credit movement with a hold.

Required stake **scales down with reputation** — established operators post less.
That is the governance layer's own compounding: trust earns you cheaper access to
trust-gated actions.

### 4.3 Hooks into the existing marketplace

`marketplace_listings` already has a lifecycle (`draft→listed→paused→closed`) and
`lib/matching.ts` ranks investors per listing. The governance layer:

- Gates `draft→listed` behind `entitlements(org).canList` + an active stake.
- Feeds `reputation_tier` and `stake` into the match ranking, so reputable,
  staked listings surface first (quality compounds in discovery, not just access).
- On `closed`, resolves the stake and (if the close is *attested*, §5) mints
  reputation.

---

## 5. Layer 3 — Security (Attestations + Escrow)

**Owns:** whether an outcome is *real*. This is what makes reputation trustworthy —
without verifiable closes, reputation is just vibes.

### 5.1 What exists

- `lib/execute-closing.ts` — the gated close checklist (IC approval, diligence
  cleared, legal/admin engaged, funding secured, close date set) with live progress.
- The **provenance/verification system** (migration 0034): managed tables carry
  `verification_status` (`unverified|verified`), `verified_at`, `verified_by`, and
  `verification_note`. This is already a per-record attestation primitive.

### 5.2 Attestations

An **attestation** is an immutable assertion that a gated step (or a whole close)
genuinely occurred, signed by an accountable party. It is the unit most worth
**anchoring on-chain later** (§2.1): it is the "proof" an institution would want to
carry off-platform.

**New table: `attestations`**

```sql
create table public.attestations (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type    text not null,   -- 'deal_close' | 'diligence_item' | 'capital_event'
  subject_id      uuid not null,
  claim           text not null,   -- e.g. 'closed' | 'funded' | 'diligence_cleared'
  attested_by     uuid references public.principals(id),  -- accountable signer
  witness_org_id  uuid references public.organizations(id), -- optional counterparty/principal-tier witness
  evidence_hash   text,            -- hash of the supporting record set (for anchoring)
  settlement      text not null default 'internal', -- internal | anchored
  anchor_ref      text,            -- tx/Merkle ref once anchored
  created_at      timestamptz not null default now()
);
```

Attestations are **append-only and never updated** — a correction is a new
attestation that supersedes, preserving the audit chain (institutional non-negotiable).

### 5.3 Escrow (milestone release)

For deals that warrant it, credits (or, later, real value) are **escrowed** and
released on attested milestones — reusing `stake_positions` with
`purpose='governance'` semantics, or a dedicated `escrow_positions` table if the
release logic diverges. Release is triggered **only** by an attestation, so funds
move on *verified* progress, never on a self-reported status. This closes the loop:
the security layer is what gives the access and governance layers something real to
compound on.

### 5.4 Closing → reputation

When `execute-closing` reaches `ready` **and** a `deal_close` attestation is
written, the system: resolves any listing stake (return), mints a `close_verified`
reputation grant, and (optionally) anchors the attestation. **This is the single
most important event in the whole model** — it is where verified work becomes
durable standing.

---

## 6. The compounding engine (all four mechanics, interlocked)

You asked for all four. They are not four features — they are four **inputs to one
score** that lowers the cost and raises the priority of a user's next action.

```
                 ┌─────────────────────────────────────────────┐
                 │              COMPOUNDING SCORE               │
                 │   (drives price discount + match priority)   │
                 └─────────────────────────────────────────────┘
                    ▲          ▲             ▲            ▲
        ┌───────────┘   ┌──────┘      ┌──────┘     ┌──────┘
   (a) Reputation   (b) Loyalty   (c) Staking   (d) Data network
   track record     + tenure      governance    effects
```

- **(a) Reputation / track-record** — the core flywheel (§4.1). Verified closes
  and vouches raise tier → cheaper access + higher match priority + lower required
  stake. *Earned, non-purchasable.*
- **(b) Loyalty + tenure** — already in `lib/billing.ts` (`loyaltyBonus`,
  `LOYALTY_STEP`, `LOYALTY_CAP`). Extend cumulative spend + tenure into the score as
  a *bounded* multiplier so longevity compounds without ever dominating merit.
- **(c) Staking for governance weight** — locking credits/reputation (§4.2) buys
  curation power and listing priority. Skin in the game, refundable, forfeitable.
- **(d) Data network effects** — every *attested* close enriches the shared graph
  (capital map, matching). Contributors earn a `data_contribution` credit rebate
  and better matching as the graph thickens. The graph is the moat; this pays
  people to widen it.

**One resolver.** A single `compoundingProfile(org)` function reads all four and
returns `{ priceMultiplier, matchBoost, requiredStakeMultiplier, tier }`. Every
layer consumes *that*, so the mechanics stay coherent and tunable in one place
rather than scattered across pricing, matching, and listing code.

**Guardrails (institutional):** merit (a) and verification (security layer) must
*dominate* purchasable inputs (b, c). Cap loyalty and stake contributions so the
system can never become pay-to-win — that is the difference between an institutional
trust graph and a points casino.

---

## 7. Data model summary

New tables (all build on, and reuse the audit pattern of, existing ones):

| Table | Purpose | Mirrors |
|-------|---------|---------|
| `reputation_scores` | current score + tier per org | `wallets` |
| `reputation_ledger` | append-only reputation movements | `credit_ledger` |
| `stake_positions` | locked/returned/forfeited credit stakes | (credit holds) |
| `attestations` | immutable, signed, optionally-anchored claims | extends `verification_status` |

No existing table is broken. Credits stay the single source of truth for value
movement; stake and escrow are *holds* on credits; reputation and attestations are
*new* ledgers that follow the exact append-only pattern already proven by
`credit_ledger`. All new tables need org-scoped RLS consistent with `0010_rls.sql`,
with `marketplace`-style public-read policies where discovery requires it.

---

## 8. Phased rollout

1. **Phase 0 — Resolvers (no schema).** Build `entitlements(org)` and
   `compoundingProfile(org)` over existing tables; wire the loyalty bonus and plan
   into pricing + match ranking. Ships compounding *feel* immediately.
2. **Phase 1 — Reputation.** Add `reputation_scores` + `reputation_ledger`; mint on
   the existing `verification_status='verified'` events. Surface tiers in the UI.
3. **Phase 2 — Attestations + closing loop.** Add `attestations`; write a
   `deal_close` attestation when `execute-closing` reaches `ready`; mint
   `close_verified` reputation. This is the keystone — do it before staking.
4. **Phase 3 — Stake-to-list + escrow.** Add `stake_positions`; gate marketplace
   listing; resolve stakes on close. Now governance has teeth.
5. **Phase 4 — On-chain anchor (optional).** Anchor `attestations` (`settlement →
   anchored`) for third-party verifiability. Validate the bridge abstraction on the
   lowest-risk unit before considering any transferable on-chain value.

---

## 9. Open questions / risks

- **Reputation subject — org or principal?** Track record likely belongs to *people*
  who move between firms. Recommend org-primary now, with a principal-level ledger
  added in Phase 1 if portability across firms becomes a requirement.
- **Vouch sybil-resistance.** Vouches must be weighted by the voucher's tier and
  rate-limited, or they become a reputation-farming vector. Specced, not yet sized.
- **Stake denomination.** Credits (closed-loop, simple) vs a separate stake unit.
  Recommend credits — keeps one source of truth and avoids a second currency.
- **Forfeiture due process.** Forfeiting a stake / penalizing reputation needs an
  appeal/dispute path before it touches real institutions. Out of scope here; flag
  for governance design.
- **Regulatory line.** Off-chain credits and non-transferable reputation are low-risk.
  The moment any unit becomes transferable-for-value on-chain, securities/AML review
  is mandatory. The substrate (§2) is designed so that line is never crossed by
  accident — only by an explicit, reviewed per-unit decision.
