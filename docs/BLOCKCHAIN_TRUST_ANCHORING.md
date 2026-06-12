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

| Question                         | Decision                                                          |
| -------------------------------- | ----------------------------------------------------------------- |
| Where does blockchain add value? | **Anchor the Chain of Trust** (Stages 1 & 7 of the lifecycle)     |
| Custody posture                  | **Anchor-only** — never hold tokens, securities, or funds         |
| Infrastructure                   | **Public L2** (e.g. Base / Polygon) — anchor a hash, nothing else |
| Scope now                        | **Ship an anchoring MVP** — additive to the existing trust flow   |
| Hard constraint                  | **No confidential information is ever disclosed on-chain**        |

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

Default provider is `local` (no key, no network) so the feature is safe to merge
dark. Production lights up by setting the provider env (chain RPC + a dedicated
anchoring key that holds *only* gas — never customer funds).

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

1. `lib/anchor/*` — merkle + provider interface + `local` default + `l2` stub.
2. `enqueueAnchor` hook in `approveEvidence` (never-block).
3. Additive migration: `anchor_leaves`, `anchor_batches` + RLS.
4. Batch cron route that folds leaves → root → `anchorRoot`.
5. A "Verify this record" surface in the Trust Center: given an authorized
   share, shows the proof bundle and a one-click recompute/verify result.

**Explicitly out:** tokenization, identity passports, stablecoin rails, any
custody, and any public-facing on-chain data beyond the Merkle root.

**Risks / watch-items:** key management for the gas-only anchoring wallet; L2
liveness (mitigated by never-block + retry on next window); ensuring the
canonical-payload serializer is stable (a format drift would break old proofs —
version the payload schema).

---

_Maintained by Claude. Encodes the Jun-12 blockchain anchoring decision:
anchor-only, public L2, confidentiality-first, additive to the Chain of Trust._
