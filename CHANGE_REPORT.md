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

## 2026-06-06

### #57 — Pin `search_path` on `private.seed_marker` _(Claude · security)_

Closes the only new database-linter finding after the Phase-4 + integrations
merges (`0011_function_search_path_mutable`). The signup-seed migration added
`seed_marker` without a fixed `search_path` while every other `seed_*` function
sets one; its body only concatenates a string literal, so an empty `search_path`
is safe. Applied to the live DB, then captured in repo history.

**Added — migration:** `supabase/migrations/20260606150000_harden_seed_marker_search_path.sql`
(`alter function private.seed_marker(text) set search_path = ''`). Additive,
idempotent, no app-code change.

### #56 — Wire integrations end to end _(Codex)_

Slack, Calendly, Apollo and the Google Workspace providers now connect, store
tokens privately, and sync — turning the Integrations catalog into live
connections.

**Added — server/lib:** `lib/integrations/oauth.ts` (provider OAuth via
`resolveServerEnv()` for Slack/Calendly/Google client IDs + secrets, scopes from
env with defaults), `lib/integrations/constants.ts` (`GOOGLE_PROVIDER_IDS`,
`GOOGLE_SCOPES`, `OAUTH_PROVIDER_IDS`, `API_KEY_PROVIDER_IDS`, cookie helpers).
**Added — routes:** per-provider `connect`/`callback`/`sync` under
`/api/integrations/*`; Apollo `connect` (API key → `private.integration_secrets`).
**Added — docs:** `docs/google-oauth-setup.md` → "Integration OAuth setup"
(env vars + redirect URIs for Google → `auth.fundexecs.com/auth/v1/callback`,
Slack/Calendly → `www.fundexecs.com/api/integrations/{provider}/callback`;
Apollo = UI API key). Tokens stay in `private.integration_secrets`; public
`integration_connections` holds only status/scopes/account metadata.

### #55 — Integrations: swap Outlook → Google Drive; add Docs & Slides _(Claude)_

The Integrations catalog drops Outlook and adds the Google Workspace file
providers, matching the read-only Drive consent.

**Changed — `app/integrations/page.tsx`:** `Provider` union, `PROVIDER_META`
and `PROVIDER_ORDER` now carry `google_drive` / `google_docs` / `google_slides`
(icons `HardDrive` / `FileText` / `Presentation`; dropped `Inbox`/Outlook).

### #54 — Phase 4 core loop: member command center _(Emergent)_

The per-member-type command center with deals, allocations, strategy,
connections, notifications, admin and trust flows — the working-beta core loop —
plus the Team brand wired through a central module.

**Added — layouts (`app/command-center/layouts/*`):** `InvestmentFirmLayout`,
`ServiceProviderLayout`, `StartupLayout`, `StudentLayout`,
`IndividualInvestorLayout`, and `MemberDashboardChrome`.
**Added — components:** `components/dashboard/{KpiTile,ChainOfTrustStrip,EarnNextBestActions}.tsx`,
`components/drawers/*`, `components/shell/trust/TrustDrawer.tsx`,
`EarnDock` (renamed from `CopilotDock`).
**Added — server actions (`lib/actions/*`):** `deals`, `allocations`, `strategy`,
`connections`, `notifications`, `admin`, `trust`, `member-profile`
(`setMemberType` → `seed_demo_for_member_type` RPC).
**Added — AI/team libs:** `lib/ai/trust-validate.ts` (`toImageMediaType` +
`ImageMediaType` for the Anthropic image union), `lib/team/{roster,index,avatar}`
(`getCOO`, `getSpecialists`, `TeamAvatar`; Earn = COO). `app/page.tsx` /
`app/login/page.tsx` now consume `lib/team`.
**Added — migrations:** `20260606120000`–`20260606140000` (5 files: evidence
columns `file_name`/`mime_type`/`ai_validation_notes`, seed-demo functions,
command-center tables). Additive + idempotent; `database.types.ts` regenerated.

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
