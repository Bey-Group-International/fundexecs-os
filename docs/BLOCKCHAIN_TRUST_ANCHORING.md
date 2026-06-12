# Blockchain Trust Anchoring — Strategy & MVP Spec

How FundExecs OS adds value with blockchain, anchored to the private-market
lifecycle. This encodes a decision: **don't build a new crypto product — make
the Chain of Trust we already ship externally verifiable.** Anchor-only, no
custody, public L2, ship an MVP — **with an absolute constraint that no
confidential information ever leaves the system.**

> Companion to `docs/PRIVATE_MARKET_LIFECYCLE.md`. Where that doc says each
> module maps to a lifecycle stage, this doc says: the *proof* each stage
> produces becomes independently verifiable, without anyone trusting FundExecs
> as custodian of the record.

---

## 1. The decision (locked)

| Question                         | Decision                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Where does blockchain add value? | **Anchor the Chain of Trust** (Stages 1 & 7 of the lifecycle)                  |
| Custody posture                  | **Anchor-only** — never hold tokens, securities, or funds                      |
| Infrastructure                   | **Internal-first.** Public L2 (e.g. Base / Polygon) is an optional later step  |
| Trust ceiling                    | **Internal now, external witness optional later** — no third-party dependency  |
| Scope now                        | **Ship an anchoring MVP** — fully internal, additive to the existing trust flow|
| Hard constraint                  | **No confidential information is ever disclosed** (and nothing public until/unless the witness is enabled) |

### Internal-first, witness-later (the key architectural call)

Two distinct guarantees were bundled inside "anchoring":

- **Tamper-_evident_ integrity** — detect if any historical record was altered,
  and prove integrity to anyone who trusts our infrastructure. **Fully
  achievable internally**: zero third parties, no chain RPC, no gas key, no
  external compliance sign-off.
- **Tamper-_proof_ external verifiability** — let an LP/auditor prove _we_ did
  not rewrite history _without trusting us_. This is impossible with internal
  storage alone (the operator can always recompute the chain) — it requires at
  least one **witness we do not control**.

Decision: **build the entire structure internally now** (hash chain + salted
Merkle commitments + verify UX), and keep the external witness as a **dormant,
one-config switch**. We get tamper-evidence and the full verify experience
immediately; upgrading to the "don't trust us" guarantee later is a provider
swap with **no schema or UX change**. The external witness, if ever enabled, is
a single ~32-byte Merkle root posted per window — not custody, not a counterparty,
~cents/window.

> Note: the earlier "compliance sign-off" caveat was conservative. Anchor-only
> hashing of our _own_ internal records (no tokens/securities/funds) is
> notarization of our own data and carries minimal external-compliance burden.

### Why this and not tokenization

We already built the asset blockchain is best at: a trust ledger
(`chain_of_trust_records` → `proof_layers` → `evidence` → `trust_events`, plus
the Memory Audit Trail). Today that ledger is an *internal claim* — an LP has to
trust our database. Anchoring turns it into an *external proof*: tamper-evident,
timestamped, and verifiable off-platform.

Tokenized fund interests, on-chain capital calls, and identity passports are
real value but pull in transfer-agent, custody, money-transmission, and
securities obligations. Anchoring needs **none** of that — it's cryptographic
notarization, not a financial instrument. It ships first and de-risks the rest.

---

## 2. Lifecycle mapping (value, strongest first)

| Stage                  | Today (internal claim)                       | Anchoring value-add (external proof)                                  |
| ---------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| **1. Establish truth** | `evidence` + AI validation + human approval  | Each approval's commitment anchored → track record provable to any LP |
| **7. Prove & compound**| Memory Audit Trail (`trust_events`, `admin_actions`) | Audit trail becomes externally verifiable institutional memory |
| 4. Convert LPs         | Soft-circle → commitment in capital stack    | Anchor the *attestation* of a commitment milestone (still no custody) |
| 5. Execute deals       | IC memo / diligence synthesis approval       | Anchor the IC decision record → provable governance trail             |

Out of scope for the MVP (deliberately): tokenization, identity passports,
on-chain money movement. Revisit only after anchoring proves the thesis.

---

## 3. Confidentiality architecture (the core constraint)

A public L2 is a public bulletin board. The discipline that makes "public chain"
and "strictly confidential" compatible: **only an opaque 32-byte commitment ever
touches the chain — never plaintext, file names, org IDs, entity types,
timestamps-with-context, counts, or any metadata.**

### What is computed, and where it lives

```
leaf       = SHA-256( salt || canonical_record_payload )   # per trust_event
            └─ salt: 32 random bytes, stored server-side, never published
            └─ payload: canonical JSON of the event (kept entirely off-chain)

root       = MerkleRoot( [leaf_1, leaf_2, … leaf_n] )       # batch of leaves
            └─ ON-CHAIN: only this root is written, once per batch window
```

- **Salting** blocks confirmation/brute-force attacks: without the salt, a party
  who already holds a candidate document still can't prove it was anchored, and
  guessable records can't be confirmed.
- **Merkle batching** (one root per time window, e.g. hourly) means the chain
  reveals neither *which* records, *how many*, nor *which org* — a root is
  indistinguishable random bytes. It also collapses cost to one tx per window.
- **Off-chain, under existing RLS:** salt, leaf preimage, Merkle proof, and the
  anchoring tx hash. These are released to an authorized verifier (e.g. an LP
  via the existing `member_profile_shares` / share-link mechanism) — never
  posted publicly.

### Verification flow (zero disclosure to the public)

1. Authorized verifier receives `{ payload, salt, merkleProof, rootTxHash }`
   over an RLS-gated share — same trust boundary as any other private data.
2. They recompute `leaf`, fold the Merkle proof to a root, and read the root
   from the L2 at `rootTxHash`.
3. Match ⇒ the record provably existed at the block's timestamp and is
   byte-identical to what was anchored. The public chain proved this **without
   ever holding the confidential content.**

### Hard invariants (must be enforced in code + review)

- The on-chain payload is **exactly** a 32-byte root. If a code path would put
  anything else on-chain, it is a bug, not a feature.
- No org-identifying or entity-identifying value is ever an argument to the
  anchor provider.
- Anchoring is **never-block** (mirrors the existing AI-validation rule):
  missing provider key, RPC failure, or timeout must degrade gracefully and
  never block an approval. A `trust_event` is fully valid un-anchored.

---

## 4. Where it hooks into the existing code

The insertion point already exists. `lib/actions/trust.ts` writes a
`trust_events` row on every approval (≈ line 463, `approveEvidence`). The
anchoring layer is purely additive:

```
approveEvidence()                      # existing — unchanged behavior
  └─ insert trust_events row           # existing
      └─ enqueueAnchor(event)          # NEW — never-block, fire-and-forget
                                       #   computes salted leaf, stores it,
                                       #   leaves batching to the worker
```

A batch worker (cron — reuse the `/api/cron/*` pattern already in
`vercel.json`) folds pending leaves into a Merkle root once per window and
writes the single root via the anchor provider.

### Provider abstraction (mock-or-real, like the integrations adapters)

```
lib/anchor/
  provider.ts     # interface: anchorRoot(root) -> { txHash, chainId } ; never-block
  local.ts        # default: records "would-anchor" locally, no chain calls (dev/off)
  l2.ts           # real: signs + submits root tx to the configured L2 (prod)
  merkle.ts       # pure: leaf + tree + proof helpers (unit-testable, no I/O)
```

Per the internal-first decision, the **`local` provider is the MVP** — it folds
leaves into roots and stores them in `anchor_batches` with no chain calls, no
key, and no network. This delivers full tamper-evidence and the verify UX with
**zero third-party dependency**. The `l2` provider stays a dormant switch: enable
the external witness later by configuring a chain RPC + a gas-only key (never
customer funds). No schema or UX change is needed to flip it on.

### Schema (additive + idempotent, per the migration invariant)

```sql
-- anchor_leaves: one salted commitment per trust_event (salt is server-only)
anchor_leaves   { id, org_id, trust_event_id, leaf_hash, salt, batch_id?, created_at }
-- anchor_batches: one Merkle root per window, plus where it landed on-chain
anchor_batches  { id, merkle_root, leaf_count, chain_id, tx_hash, anchored_at }
```

RLS: leaves are org-scoped and server-write-only (salt must never reach a
client); batch roots carry no org linkage by design.

---

## 5. MVP scope

**In:**

1. `lib/anchor/*` — merkle + provider interface + **`local` provider (the MVP)**
   + `l2` stub (dormant).
2. `enqueueAnchor` hook in `approveEvidence` (never-block), writing salted leaves.
3. Additive migration: `anchor_leaves`, `anchor_batches` + RLS.
4. Batch cron route that folds leaves → Merkle root → `anchorRoot` (which, for
   `local`, just persists the root — no chain, no key, no network).
5. A "Verify this record" surface in the Trust Center: given an authorized
   share, shows the proof bundle and a one-click recompute/verify result.

**Explicitly out:** tokenization, identity passports, stablecoin rails, any
custody, and — for the MVP — any external/public anchoring at all.

**Risks / watch-items:** ensuring the canonical-payload serializer is stable (a
format drift would break old proofs — version the payload schema). Be explicit in
the verify UX that the internal-only guarantee is "unaltered, provable to anyone
who trusts our infrastructure" — *not* operator-tamper-proof until the external
witness is enabled. Key management / L2 liveness become relevant only if/when the
`l2` provider is switched on.

---

_Maintained by Claude. Encodes the Jun-12 blockchain anchoring decision:
anchor-only, **internal-first** (external witness optional later),
confidentiality-first, additive to the Chain of Trust._
