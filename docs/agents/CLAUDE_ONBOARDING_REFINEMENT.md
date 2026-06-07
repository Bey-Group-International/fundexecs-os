# Claude — Onboarding refinement (functional + visual)

**Goal.** Make first-run onboarding orient, retain, and reward: a persistent
cross-stage **stepper + resume**, an **Earn-coin** restyle, and a finish line
that **celebrates + rewards + summarizes + nudges** the first real action.

**Surface today**

- `app/onboarding/page.tsx` — loads user/org/profile, renders `OnboardingView`.
- `app/onboarding/OnboardingView.tsx` — the **identity step** (name / role / org /
  org-type → `create_organization` RPC + `profiles` write), then hands into the
  flow. Still uses the **old flat "F"** brand mark.
- `components/proof-of-truth/ProofOfTruthFlow.tsx` (~613 lines) — stages
  `picker → qa → review → done`; resumable drafts (`saveMemberDraft`),
  per-Q&A `ProgressBar`, Earn recommendations. The `done` stage currently just
  `setStage('done')` then auto-redirects after ~1.1s (lines ~290–291).
- Sub-components: `MemberTypePicker`, `LiveProfilePanel` (live preview),
  `Recommendations`, `TagInput`.

Reuse (do not rebuild): `EarnCoin` (`@/components/screens/EarnCoin`),
`CelebrationToast` (`@/components/dashboard/CelebrationToast`), `awardTrustXp`
(`@/lib/actions/xp` → returns XP awarded), `completionPct`
(`./profile-mapping`), `MEMBER_TYPE_LABELS` / member-type variants.

---

## What to build

### 1. Persistent stepper + resume (functional)

- A shared **stepper** across the whole journey: **Identity → Profile → Review →
  Done** (Profile spans picker + Q&A). New component
  `components/onboarding/OnboardingStepper.tsx`, rendered by both `OnboardingView`
  (identity) and `ProofOfTruthFlow` (picker/qa/review/done) so the "you are here"
  state is continuous. Show a live **% complete** (use `completionPct`).
- Reflect reality: when the identity step is skipped (`hasOrg || memberType`),
  mark Identity done and start at Profile.
- **Resume / "save & finish later":** drafts already persist via
  `saveMemberDraft`; surface a visible, reassuring **"Saved — you can finish
  later"** indicator + a "Finish later" link that routes to `/command-center`
  (the dashboard already nudges to resume). a11y: stepper is an ordered list with
  `aria-current="step"`; focus moves to the new stage heading on advance.

### 2. Identity step — keep + restyle (visual)

- Replace the flat **"F"** mark with **`<EarnCoin />`** (consistency with the
  shipped brand). Bold, Earn-led hero ("Earnest Fundmaker will build your
  verified profile with you"), tighter copy, tokens-only. Keep the existing
  fields + the `create_organization`/`profiles` write exactly. Surface errors
  inline (already present). Make it the stepper's first step.

### 3. Finish line — celebrate + reward + summarize + nudge (functional + visual)

Replace the auto-redirect `done` stage with a real completion screen:

- **Reward:** on successful `saveMemberProfile`, call
  `awardTrustXp({ layer: 'truth' })` (onboarding completes the Proof-of-**Truth**
  layer). Use the returned XP to drive a **`CelebrationToast`** ("Profile
  verified · +N XP", level-up kind if it leveled them). Reduced-motion safe.
- **"What Earn set up" summary:** a recap card of the verified profile Earn just
  built — completeness %, member type, and the key captured fields (reuse
  `LiveProfilePanel`'s data) — so the value is visible before they leave.
- **First-action nudge:** end on ONE concrete next step, chosen by member type,
  e.g. fund/individual_investor → "Add your first LP" (`/pipeline`); startup →
  "Prep your materials" (`/materials`); service_provider → "See your matches"
  (`/partners` or `/inbox-intelligence`); student/default → "Open your command
  center" (`/command-center`). Provide a clear primary CTA for the nudge + a
  secondary "Go to dashboard". **Drop the 1.1s auto-redirect** in favor of these
  explicit CTAs (no surprise navigation).

### 4. Flow polish (visual, bold not flat)

- `MemberTypePicker`, `LiveProfilePanel`, `Recommendations`, `TagInput`: apply the
  campaign treatment — tone accents/rails on the now-defined semantic tokens
  (#109), bold active states, gold reserved for Earn (onboarding is Earn-led, so
  the Earn-gold accents are on-brand here). Solid `bg-bg-1`; no inline hex.
- **Mobile:** identity card, Q&A, and `LiveProfilePanel` must hold on small
  screens (live panel collapses below the Q&A on `<lg`). Inputs reuse the shared
  `Input`/`Select`/`TagInput`; keyboard-friendly (Enter advances where natural).

## Guardrails

- **Scope:** `app/onboarding/*`, `components/proof-of-truth/*`, a new
  `components/onboarding/OnboardingStepper.tsx`. Reuse `CelebrationToast`,
  `EarnCoin`, `awardTrustXp` (no new XP backend — `award_trust_xp` exists).
  **No** migrations, **no** `lib/supabase` client / `proxy.ts` / middleware /
  `app/login` / `lib/queries/auth` changes. Keep the existing
  `create_organization` / `saveMemberProfile` / `setMemberType` calls intact.
- Tokens-only; gold = Earn; keep the 15 brain slugs; no `yarn.lock`/`pnpm-lock`;
  no auth-bypass files. Don't break the resume-from-draft behavior.

## Deliverable

- Branch `claude/refine-onboarding`, **draft PR**, CI green
  (`format:check && typecheck && lint && build`), CodeRabbit-clean, with
  before/after + a11y + mobile notes and a short note on the completion reward.
  Log OLD→NEW in `docs/REFINE_PROGRESS.md`.
