# feat(ui): demo dashboard + unified side rail + LP Room shell

**Sprint:** Emergent UI lane (Feb 2026) — Tasks A + B.
**Branch:** `emergent/dashboard-lp-room` off latest `main` (no remote on the
pod; please push via Emergent's **Save to GitHub** and open this as a **DRAFT** PR).
**Boundaries:** UI-only. No touches to `lib/supabase/*`, `lib/actions/*`,
`lib/queries/*` (read-only consumption of the existing `getShellIdentity`),
`lib/ai/*`, `lib/team/*`, `lib/integrations/*`, middleware, migrations,
`app/login/*`, or auth/session.

---

## 🟦 What ships

### Task A — UnifiedSideRail + flagship InvestmentFirm dashboard
- Extracted the 244 px sidebar from `AppShell.tsx` into the canonical
  `components/shell/UnifiedSideRail.tsx`. Single source for every
  authenticated surface and any future demo / preview rail.
- Added `/lp-room` (Fund Room) nav slot **directly under Pipeline** with a
  gold `NEW` meta-badge.
- Promoted the live www.fundexecs.com CTA gradient + glow to additive
  tokens in `app/globals.css`: **`--cta-gradient`** and **`--shadow-cta`**.
  Updated `Button` `primary` variant to reference them; secondary / ghost
  / outline pick up the **gold focus ring** per the live spec. No new
  inline hex anywhere in new code.
- New dashboard sub-components — all prop-driven with exported types:
  - `Sparkline`
  - `EarnBriefingBand` (uses the live "COO · your live AI guide" framing
    and the brand's "on the record" audit caption)
  - `SynergyAlertsFeed` (Live pulse dot · 7 live personas + Student-Led
    Fund per the locked product call)
  - `FundReadinessPath` (consumes the 4-step lifecycle helper)
  - `DealFlowTable` (denser logo-disc rows)
- Persona + lifecycle fixtures (`components/dashboard/fixtures/{personas,lifecycle}.ts`):
  - Personas mirror the live homepage activity ticker — Family Office /
    Fund Manager / GP / Angel / Connector / Sponsor / Institutional LP —
    plus `student-led-fund` framed as a *participant in a student-led
    investment vehicle* (no schema rename, no `member_type` change).
  - `LIFECYCLE_STAGES` = mandate → source & raise → analyze & package →
    communicate & close (orthogonal to the 4-layer Chain of Trust hues).
- Full rebuild of `app/command-center/layouts/InvestmentFirmLayout.tsx`:
  EarnBriefingBand · 4 KPI tiles with tone-matched sparklines ·
  FundReadinessPath · DealFlowTable · SynergyAlertsFeed · LP roster +
  partnerships panels.
- `MemberDashboardChrome` hero polish (eyebrow `tracking-[0.18em]`,
  "documented as it forms" subtitle) cascades to **all 5 dashboards**
  in one place.

### Task B — `/lp-room` shell
New folder `components/lp-room/` + new route `app/lp-room/page.tsx`.
Voice anchor: **Eleanor — Head of Investor Relations**.

| Component | Responsibility |
|---|---|
| `FundOverviewCard` | Eleanor-voiced hero · 6 tabular metrics · status pill · next-close chip |
| `DocumentVaultList` | Signed-artifact index · kind icons · access tier badges · download button per row |
| `UpdateFeed` | Lifecycle-tagged change log (4-step model + Reporting) · Eleanor byline · attachment chips |
| `CommitmentTracker` | 4 headline metrics + per-LP schedule (8 personas) |
| `LpQAChat` | Threaded Q&A shell · status pills · Earn citation chips · composer fires `onSubmit?(draft)` |

Solid `bg-bg-1` everywhere — the translucent overlay legibility bug fixed
on `main` is **not** reintroduced.

---

## 🟩 Smoke screenshots (production `next start` on localhost)

> Captured at 1920×800 from the running production build of this branch.

1. **`/lp-room` hero + commitment tracker** — `unified-side-rail` ✅ (Fund Room active with gold NEW badge), `lp-fund-overview` ✅, persona schedule (incl. **E.B. · Student-Led Fund · Cambridge**) ✅.
2. **`/lp-room` mid-fold** — Update Feed (lifecycle-tagged accents) + Document Vault List (signed/Committed-LPs/Prospect-access badges).
3. **`/lp-room` Q&A** — three threads with cited answers (Side Letter · Tier-1 LP / Q4 2025 LP Report) and the composer footer "Eleanor reads every message · audit-ready replies".

(Screenshots: `/tmp/lp-room.jpeg`, `/tmp/lp-room-lower.jpeg`, `/tmp/lp-room-qa.jpeg`. The InvestmentFirm dashboard is behind `/login`; please verify visually on the Vercel preview once `main` is updated.)

---

## 🟧 Prop contracts Claude must wire

### LP Room — `components/lp-room/types.ts` (barrel-exported from `components/lp-room/index.ts`)

```ts
LpRoomData {
  fund: FundOverview;
  documents: LpDocument[];
  updates: LpUpdate[];
  commitments: CommitmentSnapshot;
  questions: LpQuestion[];
}

FundOverview { name, vintage, strategy, sizeTarget, committed, called,
               dpi?, tvpi?, irr?, nextClose?, status, oneLiner? }
LpDocument   { id, name, kind, sizeMb, uploadedAt, signed?, accessLevel }
LpUpdate     { id, postedAt, title, body, author?, authorRole?,
               lifecycle, attachments? }
CommitmentSnapshot { committed, called, distributed, remaining, schedule[] }
LpQuestion   { id, askedBy, askedAt, body, status, thread[] }
LpAnswer     { id, author, authorRole?, postedAt, body, citations? }
LpQuestionDraft { body, askerName? }    // emitted by composer onSubmit
```

Backend wiring drops `FIXTURE_LP_ROOM` from `app/lp-room/page.tsx` and
passes a real `LpRoomData` (sourced from a server query) to `<LpRoom />`,
plus `onOpenDocument` (signed-URL download) and `onSubmitQuestion`
(server action) handlers.

### Flagship dashboard — `app/command-center/layouts/InvestmentFirmLayout.tsx`

The existing `InvestmentFirmData` consumption is **unchanged** (no
breaking change to existing wiring). New **optional** props let the
backend feed the flagship sections when real data lands:

```ts
InvestmentFirmLayoutProps {
  // existing — already wired
  displayName, position, trust, load
  // new — optional, default to heuristic / fixture
  briefingPriorities?: EarnBriefingPriority[]
  synergyAlerts?: SynergyAlert[]
  lifecycleActiveIndex?: number   // 0..3, default 1
  lifecycleActivePct?: number     // 0..100, default 62
  fundReadinessPct?: number       // 0..100, default 58
}
```

---

## 🟪 Fixtures used (replace with real data)

| File | Purpose |
|---|---|
| `components/lp-room/fixtures.ts` | `FIXTURE_LP_ROOM` (+ per-section exports) |
| `components/dashboard/fixtures/personas.ts` | 8 personas + `DEFAULT_PERSONA_ACTIVITY` (synergy alerts) |
| `components/dashboard/fixtures/lifecycle.ts` | `LIFECYCLE_STAGES` + `buildLifecyclePath()` |

---

## 🟥 Explicit notes

- **`lib/team/roster.ts` verified matching live** (Earn + Sterling, Dalia,
  Theodore, Vivian, Marcus, Priya, Adrian, Sienna, Noah, Camille, Jasper,
  Eleanor = Head of Investor Relations = LP Room voice anchor, Sloane,
  Felix). **Not touched.** Confirmed in the recon report before code.
- **Student persona framing**: per the locked product decision, "Student"
  remains in `member_type` enum and `StudentLayout` is unchanged. The
  Emergent UI lane re-frames the persona in *fixtures only* as
  **"Student-Led Fund · participant in a student-led investment vehicle."**
  This includes the 8th row in `DEFAULT_PERSONA_ACTIVITY` and the
  `commit-eb` LP in `FIXTURE_COMMITMENTS.schedule`. No schema change.
  Flagged here for product/Claude awareness.
- **CTA tokens are additive only** — `--cta-gradient` and `--shadow-cta`
  ride alongside the existing `--accent` / `--shadow-md` tokens. Nothing
  was renamed or removed.
- **Overlays / drawers** continue to use solid `bg-bg-1` (verified across
  the LP Room shell). The translucent-card legibility regression is not
  reintroduced.

---

## ✅ CI gate

- `npx tsc --noEmit` → clean
- `yarn lint` → 0 errors, 1 pre-existing warning on `scripts/provision-test-users.cjs`
- `yarn format:check` → only 3 pre-existing warnings on
  `memory/PRD.md`, `memory/test_credentials.md`,
  `scripts/provision-test-users.cjs` (none introduced by this branch)
- `yarn build` → 20 routes including the new `ƒ /lp-room`

## 🛑 Do not merge

This is the stop-at-checkpoint promised in the build brief:
- Do **not** merge.
- Do **not** wire real data.
- Do **not** touch auth / backend.
- Do **not** start the 7-agent orchestration.

Awaiting Claude's review.
