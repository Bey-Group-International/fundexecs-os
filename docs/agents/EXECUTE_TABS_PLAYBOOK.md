# Execute tabs — four-agent playbook

Four agents work **in parallel**, one per Execute module tab, each driving
their interior to **full prototype UX/UI fidelity**. This file is the shared
contract; your tab's prompt is in `docs/agents/prompts/`. The conventions
mirror the Build, Source and Run swarms; territories and spec references
below are Execute's.

| #   | Tab                | Prompt                              | Live surface you own                                                                                                                                  |
| --- | ------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Closings           | `prompts/EXECUTE_TAB_1_CLOSINGS.md` | `components/execute/ClosingsFlow.tsx`, `lib/closings/**`, `lib/execute-closings/**`, `lib/queries/closings.ts`, `app/(shell)/execute/closings/**`     |
| 2   | Signatures & wires | `prompts/EXECUTE_TAB_2_WIRES.md`    | `components/execute/WiresFlow.tsx`, `lib/wires/**`, `lib/queries/wires.ts`, `app/(shell)/execute/wires/**`                                            |
| 3   | Capital calls      | `prompts/EXECUTE_TAB_3_CAPITAL.md`  | `components/execute/CapitalCallsFlow.tsx`, `lib/capital/**`, `lib/capital-calls/**`, `lib/queries/capital-calls.ts`, `app/(shell)/execute/capital/**` |
| 4   | Chain of Trust     | `prompts/EXECUTE_TAB_4_TRUST.md`    | `components/execute/ChainOfTrustFlow.tsx`, `lib/queries/trust.ts`, `lib/queries/trust-center.ts`, `app/(shell)/execute/chain-of-trust/**`             |

The spec for everyone: `prototype/execute/execute.jsx.txt` — the prototype's
entire Execute module (ExecuteHub composition, the inline Closings center,
SignaturesWires, CapitalCalls, ChainOfTrust, and ALL seeds: `EX_*`, `SIG_*`,
`WIRE_*`, `CALL_*`, `DIST_*`, `COT_*`). Shared references:
`prototype/build/data-layer.jsx.txt` and `prototype/build/ui-kit.jsx.txt`.

The prototype's tab order is Closings → Signatures & wires → Capital calls
→ Chain of Trust; the hub shell (already live) follows it and `/execute`
deep-links to `/execute/closings`.

## The Execute honesty contracts (user-approved)

This hub touches money and signatures. Two contracts bind every agent:

- **Wires are record-keeping + attestation.** Staging or clearing a wire
  writes a real record, and the copy says plainly that this RECORDS the
  wire — no money moves through FundExecs OS; the operator attests receipt
  against their bank. Banking integration upgrades this later. Bank-account
  balances render only from real connected data — absent that, an honest
  empty/`Illustrative` state, never `EX_ACCOUNTS` seeds.
- **Signatures are attestations.** Marking signed records the operator's
  attestation (real row; copy notes the document was executed outside
  FundExecs OS). Leave the e-sign hook point documented in your code — a
  DocuSign slice lands later; do NOT wire external sending in this pass.

## Branch & PR

- Branch: `agent/execute-<tab>` (e.g. `agent/execute-closings`), from
  current `main` (must include the Execute hub shell PR).
- One **draft PR** per agent, titled `Execute tab — <name>: prototype parity`.
- PR body: what the prototype shows → what was missing → what you changed,
  with a checklist mapping each prototype element to its live counterpart.
- Never push to another agent's branch or to `claude/*` branches.

## File territories (hard boundary)

Touch **only** the paths in your row above. These are shared and
**off-limits** — if your tab needs a change in one, leave a PR comment
describing it instead of editing:

- `app/(shell)/execute/layout.tsx`, `app/(shell)/execute/page.tsx`,
  `components/hubs/**` (the hub shell)
- `components/shell/**`, `app/(shell)/layout.tsx`
- `lib/hubs/**`, `components/ui/**`, `components/earn/**`
- `lib/actions/trust.ts` (shared trust writes — formation/diligence also
  log here; tab 4 reads the ledger, never rewrites it)
- `lib/supabase/**`, `supabase/migrations/**` of other tabs, `.github/**`,
  `e2e/**`, `playwright.config.ts`

If you genuinely need a migration for your own tab, follow the house pattern:
additive + idempotent (`create table if not exists`, `pg_policies` guards),
org-scoped RLS with member writes (copy `20260611240000_closings_member_writes.sql`),
and hand-patch `lib/supabase/database.types.ts` to match.
**After your PR merges, verify the migration reached the production project**
— merges do NOT auto-apply to production (preview branches only); flag it on
the PR if you cannot verify.

## Fidelity rules

1. **The prototype is the spec** for layout, hierarchy, copy tone, motion and
   flow choreography. Port px-level details to the existing Tailwind tokens
   (`fg-1..5`, `surface-1..3`, gold/azure/success/warning/danger/info
   soft+line vars, hairline borders) — never raw hex.
2. **Honest data only.** Every row and number on the live surface must come
   from Supabase or be clearly absent (real empty states). Regulated
   surfaces keep their `Illustrative` badges. Nothing fake is ever written
   to the database.
3. **The approve loop is law.** Every mutation — executing a step, marking
   signed, recording a wire, confirming capital — runs through
   `components/earn/ActionRunner` (steps → draft → "Approve & execute" →
   real server action; only success closes). The prototype's per-row `run`
   payloads end with **"Log to Chain of Trust"** — make that literally true
   via `chain_of_trust_records` where your action completes something.
4. **Server-enforced transitions.** Status gates live in the server action,
   not just the UI — pending → ready → signed/wired, in order.
5. Pure logic goes in a `lib/<domain>/` vocabulary module with `node:test`
   unit tests (`import { test } from 'node:test'`, `assert/strict`).
6. Client components: `'use client'`, lucide-react icons, `motion/react`
   with `useReducedMotion` for anything animated.

## Gates (all must pass before you push)

```bash
npm run typecheck && npm run lint && npm run format:check \
  && npm run test:unit && npm run build
```

`npx prettier --write <files>` fixes formatting. Commit messages: imperative
summary + body explaining prototype-parity changes.

## Definition of done

- Every element in your tab's prototype component has a live counterpart or
  a written justification in the PR body for divergence (honest-data being
  the usual one).
- Deep link (`/execute/<tab>`) renders your tab inside the hub shell with no
  duplicate hub-level hero.
- Gates green; unit tests added for any new pure logic.
- PR opened as draft with the fidelity checklist filled in.
