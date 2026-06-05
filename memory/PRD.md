# FundExecs OS — PRD

Next.js 16 App Router + Supabase (Auth/Postgres/pgvector/Storage) + Tailwind v4.
A private-markets operating system with a 15-AI specialist team
(Earnest is COO, never called "copilots"). Built on Vercel.

## Current sprint status

| phase   | scope                                                                                                                                       | status              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Phase 1 | §3H Team identity carry-over                                                                                                                | ✅ DONE             |
| Phase 2 | Deliverable D — 5 member-type dashboard layouts                                                                                             | ✅ DONE             |
| Phase 3 | Foundational: middleware gate, /api/ask-earn never-block, signup seed + per-type top-up migration                                           | ✅ DONE — 2 patches |
| Phase 3 | Runtime: live migration + 5 test users + row-count snapshot                                                                                 | ✅ DONE 2026-02-06  |
| Phase 4 | Core-loop persistence — server actions across Pipeline / Connections / Strategy / Notifications / Admin (A–E)                               | ✅ DONE 2026-02-07  |
| Phase 4 | Deliverable F (Settings) — handled by external Codex bot, merged to `main`                                                                  | ✅ DONE (external)  |
| Phase 5 | Chain of Trust end-to-end persistence: migration + Storage bucket, server actions, AI validation, DB-driven drawer + dashboard wiring (A–E) | ✅ DONE 2026-02-07  |
| Phase 6 | Mocked integrations connect path                                                                                                            | ⏳ NOT STARTED      |
| Phase 7 | Polish + regenerate `database.types.ts` + re-embed brains                                                                                   | ⏳ NOT STARTED      |

## Phase 5 — what shipped (this session)

- **5-A**: `supabase/migrations/20260606140000_phase5_trust_evidence_storage.sql` —
  additive `evidence` workflow columns (file_name, mime_type, size_bytes,
  approval_status, ai_validation_notes, etc.), private `trust-evidence`
  Storage bucket with org-scoped RLS, member UPDATE policy on evidence.
- **5-B**: `lib/actions/trust.ts` server actions —
  `startChainOfTrust`, `advanceProofLayer`, `uploadEvidence`,
  `finalizeEvidenceUpload`, `approveEvidence`, `revokeEvidence`,
  `loadTrustRecord`. All RLS-bound. Service role used only to mint
  signed upload URLs.
- **5-C**: `lib/ai/trust-validate.ts` — Anthropic-backed AI validation
  for uploaded evidence. **Never-block**: missing key / timeout / API
  failure all fall through to a manual-review fallback note. Service
  role used only for the read-side object download.
- **5-D**: `components/shell/trust/TrustDrawer.tsx` rewrite —
  DB-driven mode via `loadTrustRecord(recordId)`, starter mode that
  creates a chain on confirm, legacy presentational mode kept for the
  toaster fallback. Per-layer evidence sections with approve/reject
  controls gated on org owner/admin or uploader. Activity timeline
  from `trust_events`. `components/drawers/EvidenceUploadForm.tsx`
  drives the two-step signed-URL upload (server mints token → client
  PUTs blob → server finalizes + kicks off AI). All hardcoded
  literals (Atlas Manufacturing, Cedar/DL-220) removed.
- **5-E**: `components/shell/trust/TrustDrawerHost.tsx` (new) —
  context provider mounted by `MemberDashboardChrome` so the CoT strip
  - per-deal Trust chips share one drawer instance. `DealTrustChip`
    ("Start CoT" / "Trust · N%") rendered on GP `InvestmentFirmLayout`
    and LP `IndividualInvestorLayout` deal rows. `ChainOfTrustStrip`
    converted to a button that opens the drawer for the member's own
    profile chain.

## Test surface

5 seeded users on the live `emityvdaeiqxtpxdhyky` project (credentials

- row-count snapshot in `/app/memory/test_credentials.md`). The
  investment_firm user (`28bebb95-…`) is `status='complete'` so the GP
  dashboard renders against real data.

### Phase 5 E2E smoke results (2026-02-07)

`scripts/phase5-e2e-smoke.cjs` exercises start-chain → upload-evidence
→ AI-validate → approve → layer-advance → XP-award against the live
DB as the investment_firm org owner. **Before / after deltas**:

| table                    | before | after | delta |
| ------------------------ | ------ | ----- | ----- |
| `chain_of_trust_records` | 6      | 7     | +1    |
| `proof_layers`           | 4      | 8     | +4    |
| `evidence`               | 0      | 1     | +1    |
| `trust_events`           | 8      | 9     | +1    |
| `profiles.xp` (IF user)  | 270    | 285   | +15   |

Chain: `Harbor data-center JV` → `Proof of Truth` approved 100% →
`current_layer='Proof of Concept'`, `completion_percentage=25`.
AI validation note from Claude (736 chars) stored on the evidence row.

### Branches

- `phase4-core-loop` — Phase 4 A–E + Codex F spec doc. Push to remote
  `emergent/phase4-core-loop` is **parked** (user handles via the
  Emergent "Save to GitHub" feature — CLI auth from the pod is
  read-only). Diff: 63 files, 6654 insertions, 1155 deletions.
- `phase5-chain-of-trust` — Phase 5 A–E. 4 commits delta vs
  `phase4-core-loop`: `feat(trust): drawer reads DB records`,
  `feat(dashboard): trust chip + clickable CoT strip`,
  `chore(types): query helpers expose trust record id`,
  `chore: prettier auto-fix on phase4 spec doc`.

## Backlog / next

- **P1** Phase 6: Mocked integrations connect path.
- **P2** Phase 7: Polish + regenerate `lib/supabase/database.types.ts`
  (currently bypassed with `as never` / `as unknown as` casts).
- **P2** `app/admin/AdminView.tsx` still has a static
  "Atlas Manufacturing" example card (Phase 4 territory). Replace
  with a real top-org tile in Phase 6 / 7.

## Invariants

- "Copilot" is retired across the UI. Use "specialist" / "executive
  team". Earn is COO.
- `lib/team/*` is the single source of truth for the 15 specialists.
- All Supabase secrets are read from `process.env`, never inlined.
- CI green: `yarn format:check && yarn build && yarn typecheck && yarn lint`.
- Migrations are additive + idempotent. No drops.
- Brain slugs frozen.
- AI calls are **never-block**: missing key / timeout / API failure
  must degrade gracefully and never blockade an approval path.
