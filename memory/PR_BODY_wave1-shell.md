# feat(ui): wave-1 shell — unified rail + dashboard + fund profile + top nav + earn modal + settings

> ⚠️ **DO NOT MERGE — awaiting Claude review.**
>
> This PR ships the Wave-1 UI shell on top of Claude's read-only Wave-1
> data-layer (PR #81, merged at `b8b80ce`). It is intentionally a draft so
> Claude can review the prop/type contracts and loader bindings before any
> downstream PR (#84 seams · #85 perf · #82 admin · #79 LP Room · close #78)
> is rebased on top.

## Scope

Strict UI-only lane:

- 🟢 `app/` (new + replaced routes), `components/` (net-new shell + fund-profile + 9 dashboard sub-components), `app/globals.css` (one new keyframe), `scripts/` (3 dev utilities).
- 🔒 Untouched: `lib/supabase/*`, `lib/actions/*`, `lib/queries/auth.ts`, `lib/ai/*`, `lib/team/*`, `lib/integrations/*`, `middleware.ts`, `proxy.ts`, migrations, `app/login/*`. 15 brain slugs in `lib/team/roster.ts` unchanged.

## Commits

| Commit | SHA       | Summary                                                                                                                                                          |
| ------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | `3c50211` | Unified 6-area side rail (Source-of-Truth · Daily · Capital · Deal · Intelligence · Audit), top nav (org switcher · ⌘K · alerts · Earn coin · Credit Wallet), 14 stub routes |
| 2      | `b4b756d` | `LifecycleDashboard` — single canvas replaces 5 legacy layouts. 9 sub-components, member-type variant matrix internal. Legacy moved to `app/command-center/layouts/_legacy/` |
| 3      | `376d70f` | Fund Profile (4 sub-components) + EarnContext (route default + drawer overrides) + Settings rebuilt as vertical detail rail. DealDetailDrawer wraps as POC override |
| —      | `9d37f77` | `chore(scripts):` Wave-1 dashboard variant capture helper                                                                                                        |
| —      | `8142251` | `chore(prettier):` ignore `.emergent/` platform metadata                                                                                                         |

Plus 2 platform auto-commits: `ca2f53b`, `58864d8`, `bf09f1f`.

**HEAD:** `8142251` · **Base:** `b8b80ce` (`main` at PR #81 merge) · **Branch diff:** 62 files / +8,405 / -740.

## CI gate

```
npx tsc --noEmit   ✅
yarn lint          ✅
yarn format:check  ✅
yarn build         ✅
```

---

## Exported prop / type contracts

These are the public surfaces every Wave-1 shell consumer relies on. Anything that touches Claude's loaders is documented here verbatim.

### Shell — `components/shell/AppShell.tsx`

```ts
export interface AppShellProps {
  title: string;
  subtitle?: string;
  /** Signed-in identity for the rail + top nav. Falls back to a generic
   *  identity (never a fabricated name) when omitted. */
  identity?: ShellIdentity | null;
  /** Credit-wallet payload from `getCreditWallet(orgId)`. */
  wallet?: CreditWallet | null;
  /** Live signals for the side rail (current lifecycle stage + per-item badges). */
  navSignals?: NavSignals;
  /** Optional compact card the rail renders at the top of the "Source of Truth"
   *  area. Wave-1: typically a `<FundProfileRailSummary>` resolved upstream. */
  sourceOfTruthSummary?: ReactNode;
  children: ReactNode;
}
```

### Shell — `components/shell/AuthedShell.tsx`

```ts
export interface AuthedShellProps {
  title: string;
  subtitle?: string;
  /** Path the caller is on — used for the post-login redirect. */
  redirectFrom?: string;
  children: ReactNode;
}
// Server-async wrapper: resolves identity + org + wallet + nav-signals +
// fund profile (for Source-of-Truth summary) once per request.
```

### Rail — `components/shell/Wave1SideRail.tsx`

```ts
export interface RailNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** True for routes that ship UI in Wave 1; stubs are routed but flagged. */
  live?: boolean;
}

export interface RailNavGroup {
  /** Stable key — used to look up stage emphasis. */
  key:
    | 'source-of-truth'
    | 'daily-execution'
    | 'capital-formation'
    | 'deal-execution'
    | 'intelligence'
    | 'audit';
  label: string;
  /** One-line description shown under the group label on the rail. */
  description?: string;
  items: RailNavItem[];
}

export interface RailSignal {
  /** Pre-formatted value (e.g. "12", "78%"). */
  value: string | number;
  tone?: BadgeTone;
  /** Hover hint on the badge. */
  hint?: string;
}

export interface NavSignals {
  /** Current lifecycle stage — drives the subtle gold emphasis on the area
   *  group whose modules own this stage's work. */
  currentStage?: LifecycleStage;
  /** Per-href signal badges. */
  badges?: Record<string, RailSignal>;
}

export interface Wave1SideRailProps {
  pathname: string;
  open: boolean;
  onClose: () => void;
  identity: ShellIdentity;
  signals?: NavSignals;
  /** Optional node the rail mounts at the top of the "Source of Truth" group. */
  sourceOfTruthSummary?: ReactNode;
  onSignOut?: () => void | Promise<void>;
}

export const RAIL_GROUPS: RailNavGroup[]; // exported for tests
```

### Top Nav — `components/shell/Wave1TopNav.tsx`

```ts
export interface Wave1TopNavProps {
  title: string;
  subtitle?: string;
  identity: ShellIdentity;
  wallet?: CreditWallet | null;
  onMenu?: () => void;
  onAskEarn?: () => void;
}
```

### Credit Wallet — `components/shell/CreditWalletGauge.tsx`

```ts
export interface CreditWalletGaugeProps {
  wallet?: CreditWallet | null;
}
```

### Dashboard — `components/dashboard/LifecycleDashboard.tsx`

```ts
export interface MemberTypeVariant {
  /** Hero greeting eyebrow ("Chief Operating Officer · your live AI guide"). */
  eyebrow: string;
  greeting: (firstName: string) => string;
  summary: string;
  /** Order of the four "operate row" sub-sections. */
  operateOrder: readonly ('alerts' | 'daily' | 'stage' | 'raise')[];
}

export const MEMBER_TYPE_VARIANTS: Record<MemberType | 'default', MemberTypeVariant>;

export interface LifecycleDashboardProps {
  /** Display name used in the hero greeting. */
  displayName: string;
  /** Resolved member type (or null when onboarding is in progress). */
  memberType: MemberType | null;
  /** Lifecycle-aware payload from `getDashboardData(orgId)`. */
  data: DashboardData;
}
```

### Fund Profile — `components/fund-profile/*`

```ts
// FundProfileHero.tsx
export interface FundProfileHeroProps {
  profile: FundProfile;
  className?: string;
}

// FundProfileSections.tsx
export interface FundProfileSectionsProps {
  profile: FundProfile;
  className?: string;
}

// FundProfileGapsCard.tsx
export interface FundProfileGapsCardProps {
  profile: FundProfile;
  className?: string;
}

// FundProfileRailSummary.tsx — compact summary for narrow surfaces (the rail)
export interface FundProfileRailSummaryProps {
  profile: FundProfile;
  href?: string; // defaults to /profile
  className?: string;
}
export function FundProfileRailSummaryEmpty(props: { href?: string; className?: string }): JSX.Element;
```

### Earn context — `components/shell/earn/EarnContext.tsx`

```ts
export type EarnContextKind =
  | 'dashboard' | 'fund-profile' | 'trust' | 'pipeline' | 'lp'
  | 'deal-desk' | 'deal' | 'capital-stack' | 'objection'
  | 'intelligence' | 'materials' | 'partners' | 'audit'
  | 'settings' | 'action-queue' | 'match-inbox' | 'onboarding' | 'generic';

export interface EarnContextValue {
  kind: EarnContextKind;
  entityId?: string;
  entityLabel?: string;
}

export interface EarnContextProviderProps {
  value?: Partial<EarnContextValue>;
  children: ReactNode;
}

export function EarnContextProvider(props: EarnContextProviderProps): JSX.Element;
export function useEarnContext(): EarnContextValue;
export function inferEarnContextFromPath(pathname: string | null): EarnContextValue;
```

### Dashboard rail signals — `lib/dashboard-rail-signals.ts`

```ts
export function buildRailSignals(data: DashboardData): NavSignals;
// Pure helper. Lives outside lib/queries (UI-lane forbids editing those).
```

---

## Loader binding map

Every Wave-1 surface reads from Claude's Wave-1 loaders (`lib/queries/*`). No new server actions, no schema changes. The matrix below shows which component consumes which loader field.

| Component                                | Loader                                              | Fields consumed                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthedShell`                            | `getShellIdentity()`                                | full payload                                                                                                                                                                 |
| `AuthedShell`                            | `getActiveOrg()`                                    | `orgId`                                                                                                                                                                      |
| `AuthedShell`                            | `getCreditWallet(orgId)`                            | full payload (renders `<CreditWalletGauge>`)                                                                                                                                 |
| `AuthedShell`                            | `getDashboardData(orgId)` → `buildRailSignals(d)`   | `data.stage`, `data.majorAlerts.length`, `data.fundProfile.completenessScore`, `data.fundProfile.gaps.length`, `data.dailyCommand.length`                                    |
| `AuthedShell`                            | `getFundProfile(orgId)`                             | full payload → `<FundProfileRailSummary profile>`                                                                                                                            |
| `app/command-center/page.tsx`            | `getDashboardData(orgId)`                           | full payload → `<LifecycleDashboard data>`                                                                                                                                   |
| `app/command-center/page.tsx`            | `getFundProfile(orgId)`                             | full payload → rail summary (parallel fetch)                                                                                                                                 |
| `app/profile/page.tsx`                   | `getFundProfile(orgId)`                             | full payload → hero / gaps / sections / rail summary                                                                                                                         |
| `app/settings/page.tsx`                  | `getFundProfile(orgId)` + `getDashboardData(orgId)` | profile → rail summary · dashboard → `buildRailSignals`                                                                                                                      |
| `LifecycleDashboard`                     | `DashboardData`                                     | `stage`, `stageBlurb`, `loopProgress`, `nextBestAction`, `executionScore`, `readinessScore`, `readinessBreakdown`, `majorAlerts`, `dailyCommand`, `stageKpis`, `raiseProgress`, `activityFeed`, `fundProfile.{fundName,completenessScore}` |
| `FundProfileHero` / `Sections` / `Gaps` / `RailSummary` | `FundProfile`                            | `fundName`, `managerName`, `fundTier`, `memberType`, `focusAreas`, `completenessScore`, `gaps[]`, `thesis`, `strategy`, `targetRaise`, `terms`, `trackRecord`, `team`         |

**Resilience:** Every fetch in `AuthedShell`, `app/profile/page.tsx`, `app/settings/page.tsx`, and `app/command-center/page.tsx` for non-required surfaces wraps in `.catch(() => null)` — the shell degrades gracefully (rail without badges, no summary card, no wallet gauge) rather than failing the whole route.

---

## Variant matrix — 5 member-type dashboards

Source of truth: `MEMBER_TYPE_VARIANTS` in `components/dashboard/LifecycleDashboard.tsx`. All five personas were re-captured against HEAD `8142251` with the staging accounts at `member_profiles.status = complete` (idempotent re-flip via `yarn wave1:complete-test-onboarding`).

| Persona             | Greeting line                                  | Operate-row order                       | Summary copy                                                                                                                  |
| ------------------- | ---------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| investment_firm     | `Today's plan, {name}.`                        | stage → raise → alerts → daily          | Run the desk like a far larger institution — every move on the record, audit-ready, documented as it forms.                   |
| individual_investor | `Good to see you, {name}.`                     | stage → alerts → daily → raise          | Your private allocator desk — Earn keeps the watchlist warm, the diligence clean, and the conviction sharp.                   |
| service_provider    | `Welcome back, {name}.`                        | daily → stage → alerts → raise          | Inbound, ideal-client matches, and demand signal — Earn keeps the practice on the record.                                     |
| startup             | `Hey {name} — let's get the raise closed.`     | raise → daily → stage → alerts          | Raise materials, warm intros, investor targets — Earn keeps every conversation audit-ready.                                   |
| student             | `Welcome, {name}.`                             | daily → stage → alerts → raise          | Your student-led-fund desk — Earn shapes the loop while you build the institution's instincts.                                |
| _default (unset)_   | `Good to see you, {name}.`                     | stage → alerts → daily → raise          | Your private-markets command center — Earn coordinates the team and your Chain of Trust holds the proof.                      |

**Invariants across all variants:**

- Eyebrow line is always `Earnest Fundmaker · Chief Operating Officer · your live AI guide`.
- Spotlight row (Next Best · Execution · Readiness) order is fixed.
- Hero · Lifecycle rail · Spotlight · Operate-row · Activity-feed (audit) layout is fixed.
- Member-type-specific copy lives **only** in `MEMBER_TYPE_VARIANTS` — everything else is data-driven from `DashboardData`.

---

## Earn context — voice and action matrix

Source of truth: `CONTEXT_COPY` in `components/shell/earn/EarnContextCopy.ts`. Voice line is **uniform** ("Chief Operating Officer · your live AI guide") across every surface; only the subtitle, the AI-team activity glimpse, and the quick-action chips switch with `kind`.

| Kind            | Subtitle                                              | Example actions                                                                |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| dashboard       | Today's command center · what to act on next          | Rank today's priorities · Where am I in the lifecycle? · Summarize last 24h    |
| fund-profile    | Source of Truth · documented as it forms              | Close my profile gaps · Sharpen my thesis · LP-probe stress test               |
| trust           | Chain of Trust · every claim provable                 | Validate latest evidence · Highlight any gaps · Audit-ready summary            |
| pipeline        | LP Pipeline · move warm conversations forward         | Rank LPs by convertibility · Draft outreach to stalled LPs · Build target list |
| lp              | LP focus · move this relationship forward             | Draft next-touch email · Snapshot the relationship · Forecast convertibility   |
| deal            | Deal in focus · diligence, conviction, capital        | Run diligence on this deal · Draft IC memo · Pressure-test conviction          |
| capital-stack   | Capital Stack · raise pacing on the record            | Pace the raise · Show concentration risk · Close-document checklist            |
| audit           | Audit · every decision provable + reusable            | Replay last big decision · Audit-ready export                                  |
| settings        | Profile & settings · how Earn speaks for you          | What does each setting unlock? · Help me complete my profile                   |
| _generic_       | Your live AI guide · the team behind every action     | What should I do next? · Brief me on my fund · Pull a comp / play              |

(17 kinds total — full table in `EarnContextCopy.ts`.)

### Override pattern — drawer takes precedence over route

`DealDetailDrawer` wraps its content in:

```tsx
<EarnContextProvider value={{ kind: 'deal', entityId: deal.id, entityLabel: deal.name }}>
  <Drawer …>…</Drawer>
</EarnContextProvider>
```

Result: when a deal drawer takes focus on `/pipeline`, the dock switches to `kind='deal'` while the URL stays at `/pipeline`. Closing the drawer drops back to the route default. **`/api/ask-earn` payloads + `EarnChat` are intentionally untouched** — this is a presentational hint, not a routing change.

---

## Screenshot index

All screenshots live under `/app/.screenshots/wave1-commit{1,2,3}/`. Each shot was captured against a real headless Chromium session logged in to a staging account at HEAD `8142251`. No synthetic identity mounts; no `_preview/` files.

### `.screenshots/wave1-commit1/` — chrome smoke (6 frames)

- `chrome-firm.jpeg`, `chrome-individual.jpeg`, `chrome-service-provider.jpeg`, `chrome-startup.jpeg`, `chrome-student.jpeg` — side rail + top nav rendering on each persona
- `chrome-stubs.jpeg` — one of the 14 stub routes (Action Queue / Trust Center / etc.)

### `.screenshots/wave1-commit2/` — dashboard variants (6 frames, re-captured at HEAD `8142251`)

- `dashboard-firm.jpeg` — investment_firm variant (operate: stage → raise → alerts → daily)
- `dashboard-individual.jpeg` — individual_investor variant (operate: stage → alerts → daily → raise)
- `dashboard-service-provider.jpeg` — service_provider variant (operate: daily → stage → alerts → raise)
- `dashboard-startup.jpeg` — startup variant (operate: raise → daily → stage → alerts)
- `dashboard-student.jpeg` — student variant (operate: daily → stage → alerts → raise)
- `rail-real-signals.jpeg` — firm rail showing live badges + Source-of-Truth summary card emphasis

### `.screenshots/wave1-commit3/` — Fund Profile + Earn context + Settings rail (7 frames)

- `fund-profile.jpeg` — hero ring · gaps card · 6 LP-probed sections · rail summary visible
- `rail-source-of-truth-summary.jpeg` — close-up of the new rail card
- `earn-dashboard-context.jpeg` — Earn dock open on `/command-center` ("Today's command center · what to act on next")
- `earn-fund-profile-context.jpeg` — Earn dock open on `/profile` ("Source of Truth · documented as it forms" + LP-probe actions)
- `earn-pipeline-context.jpeg` — Earn dock open on `/pipeline` ("LP Pipeline · move warm conversations forward")
- `settings-rail.jpeg` — vertical detail rail, Account section active
- `settings-trust-section.jpeg` — Trust profile section active via `/settings#trust` deep link

**Total:** 19 screenshots across 3 commits.

---

## Reviewer notes

- Pod CLI is read-only — **the user is pushing this branch via the Emergent "Save to GitHub" panel.** Please don't push from upstream after merging downstream PRs.
- The two screenshot helpers (`scripts/wave1-commit2-dashboards-refresh.cjs`, `scripts/wave1-commit3-screenshots.cjs`) are dev fixtures — feel free to remove from main if downstream prefers a single canonical script.
- `yarn.lock` is included because the lockfile was previously untracked. If your CI generates it, feel free to drop the file in review.
- The `.prettierignore` entry for `.emergent/` is a tiny meta-change to keep `format:check` green; the platform writes that file with double-quoted JSON which prettier (yaml mode) wants single-quoted.

## Follow-up backlog (not blocking merge)

- Wrap remaining entity drawers (`LpDetailDrawer`, `ContactDetailDrawer`, `ObjectiveDrawer`) in `<EarnContextProvider>` with the appropriate `kind` so the dock can show entity-specific actions on every focused workflow.
- Mobile 390×844 sweep on all new Wave-1 surfaces (Fund Profile, Settings rail, Earn dock on small viewports).
- a11y axe pass on Fund Profile + Settings rail.
- Wire `CreditWalletGauge` to real Stripe state once the wallet config flips to `configured: true`.
- Move 5 dashboard variants' copy into `lib/team/` if Claude wants member-type voice owned by the team module instead of the dashboard component.

## DO NOT MERGE — awaiting Claude review

Downstream merge sequence (after Claude approves): `wave1-shell` → PR #84 (seams) → #85 (perf) → #82 (admin) → #79 (LP Room) → close #78.
