# FundExecs OS — Change Report

A living log of changes shipped to FundExecs OS. Newest first. Each entry notes
the PR (or operational change), the author/agent, the user-facing impact, and the
concrete **new features / components / functions** added.

> **Conventions.** Code lands via squash-merged PRs into `main`; production
> deploys from `main` on Vercel. Work happens on isolated branches —
> `emergent/*` (Emergent), `codex/*` (Codex), `claude/*` (Claude). Keep the 15
> AI-brain `slug`s stable (they back the Voyage embeddings); migrations are
> additive + idempotent; secrets stay server-side.

---

## 2026-06-05

### #52 — Persist Settings account & organization saves _(Codex · Phase 4 §3B)_

Settings Account and Organization tabs now save for real, with auth/role gating,
validation, and proper pending/success/error states.

**Added — files:** `app/settings/actions.ts` (new server-action module).
**Added — functions (server actions):**

- `updateAccountSettings(prevState, formData)` — updates `profiles.full_name/role`
  and upserts `member_profiles.bio` + `details.contact_phone`; auth-gated, with
  zero-row update checks so a non-matched row reports an error, not silent success.
- `updateOrganizationSettings(prevState, formData)` — updates
  `organizations.name/type`; gated to org `owner`/`admin`.
- Helpers: `result()`, `cleanStr()` (trim + max-length), `isOrgType()` (enum
  guard), `jsonRecord()` (safe JSON merge). Interface `SettingsActionState`.

**Added — components (`app/settings/SettingsView.tsx`):** `SaveButton`
(uses `useFormStatus` for pending state), `ActionNotice` (success/error message).
`AccountSection` / `OrganizationSection` rewired to `<form action>` +
`useActionState`. **Changed — `app/settings/page.tsx`:** now loads `org type`,
Proof-of-Truth `bio`, and `phone` from SSR. RLS-respecting writes; no migrations,
no brain-slug/service-role changes.

### #50 — Generated avatar graphics for each team member _(Claude)_

Each landing "Team" specialist now has a distinct, deterministic avatar instead
of a plain monogram.

**Added — functions/components (`app/page.tsx`):** `AVATAR_GRADIENTS` (curated
palette), `avatarGradient(name)` (FNV-1a hash → stable gradient; gold reserved
for Earn), `MemberAvatar` component (gradient crest + facet highlight + function
glyph). **Removed:** the `initials()` monogram avatar.

### #49 — Rebrand "The Copilots" → the 15-person executive Team _(Claude)_

The landing recasts the copilots as an institutional **Team** of 15 (the Earn
brains): **Earnest Fundmaker ("Earn") — Chief Operating Officer** leading 14
named specialists.

**Added — types/data/components (`app/page.tsx`):** `TeamMember` interface, `TEAM`
data array (14 specialists: name + position + role), `Team()` section, `TeamCard`
component. Hero gained a minimal **Meet Earn** block under the avatar; **Chain of
Trust** and **How it works** cards were elevated (layer accent + `ShieldCheck`
mark; numbered badges + supporting copy). **Changed:** `app/login` language
aligned to the landing; `HeroStats` now reads "15 AI specialists"; section anchor
`#copilots → #team`; tighter spacing across breakpoints. **Removed:** legacy
`Copilot`/`Cluster` types, `CLUSTERS`, `Copilots()`, `CopilotCard`, and the
standalone `MeetEarnest()` section.

### Proof of Truth — Earn-guided onboarding _(#43 / #42 · Claude)_

A conversational, approval-gated flow where Earn helps a member build a verified,
member-type-specific profile.

**Added — server/AI:** `lib/proof-of-truth/questions.ts` (per-type question sets),
`lib/proof-of-truth/earn-profile.ts` (Earn system prompt + `provide_recommendations`
tool contract `{ insight, options[3] }`), `lib/ai/profile-suggest.ts`
(`recommendProfileAnswers()` via forced tool-call), route `POST /api/earn/profile-suggest`,
and the `saveMemberProfile` server action. **Added — components
(`components/proof-of-truth/*`):** `ProofOfTruthFlow`, member-type picker,
per-field Earn **Recommend** (3 options, 👍 approve / 👎 disapprove / ♾️
regenerate — nothing enters the profile until approved), live profile panel,
`TagInput`, review step. Wired into `app/onboarding/*` and a Settings status card.

### #40 — Unified marketing landing as the homepage _(Claude)_

Full institutional landing at `/` (`app/page.tsx`) integrated with the design
system. **Added — components (`components/landing/*`):** `LandingNav`,
`HeroStats` (animated count-ups), `ActivityTicker`, `SmoothScrollLink`.

### Platform health & consolidation _(operational / infra fixes · Claude)_

- **Auth + Supabase host alignment (#47 / #46 / #45).** Pointed the app at the
  active Supabase custom domain `https://auth.fundexecs.com`
  (`emityvdaeiqxtpxdhyky`) and canonical host `https://www.fundexecs.com`.
  **Added — function:** `resolveServerEnv(suffix)` in `lib/supabase/admin.ts`
  (prefix-agnostic env resolution) — fixed the `/api/knowledge/embed` 500.
  Updated `getSiteURL()`/`metadataBase` to the `www` host.
- **Google OAuth fixed.** Registered `https://auth.fundexecs.com/auth/v1/callback`
  → cleared `redirect_uri_mismatch`; Google sign-in works end to end.
- **RAG embedded.** Ran `POST /api/knowledge/embed`; `knowledge_chunks` = 15/15
  via Voyage; Ask Earn answers grounded.
- **Duplicate projects removed.** Deleted the redundant Vercel project
  (`bey-group-international/fundexecs-os`) and the empty Supabase project
  (`intuhcypgttgowovtmdf`) that caused a split-brain + misleading `403`.
- **Phase-4 test data.** 5 test users (one per `member_type`), each owner of its
  own workspace; migration idempotency re-run added no duplicates (11 total).

### Emergent sprint brief _(#51 / #48 / #44 · Claude)_

`EMERGENT_PHASE4_SPRINT.md` — the Phase 4 → Working Beta brief: verified platform
baseline + gotchas, the Team brand canon, the landing structure, env-var table,
and work items A–H.

---

_Maintained by the Claude watch session; appended as each PR merges to `main`,
including the new features / components / functions each one adds._
