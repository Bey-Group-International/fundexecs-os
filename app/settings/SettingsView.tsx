'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Building2,
  CreditCard,
  Lock,
  Mail,
  Phone,
  Plug,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  Zap,
  type LucideIcon
} from 'lucide-react';
import { Avatar, Badge, Button, Card, Input, ProgressBar, SectionTitle } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';
import type { Database } from '@/lib/supabase/database.types';
import type { OrgSubscription } from '@/lib/queries/subscription';
import type { IntegrationView } from '@/lib/integrations/catalog';
import { cn } from '@/lib/utils';
import { IntegrationsPanel } from '@/components/integrations/IntegrationsPanel';
import { SetPasswordForm } from '@/components/account/SetPasswordForm';
import { PlanCreditsSection } from './PlanCreditsSection';
import { AdminView } from '@/app/admin/AdminView';
import type { AdminData } from '@/lib/queries/admin';
import type { AdminMetrics } from '@/lib/queries/admin-metrics';
import type { ReferralOverview, ReferralTier } from '@/lib/queries/referrals';
import type { LaunchTrend } from '@/lib/queries/admin-snapshots';
import type { BetaInvite } from '@/lib/queries/beta-invites';
import type { BetaLinkWithStatus } from '@/lib/queries/beta-links';
import type { BetaApplication } from '@/lib/queries/beta-applications';
import { updateAccountSettings, updateAvatar, type SettingsActionState } from './actions';
import { OrganizationSection } from './OrganizationSection';
import type { OrgTeam } from '@/lib/queries/org-members';

type OrgType = Database['public']['Enums']['org_type'];
type OrgMemberRole = Database['public']['Enums']['org_member_role'];

interface SettingsViewProps {
  email: string | null;
  fullName: string | null;
  role: string | null;
  bio: string | null;
  phone: string | null;
  /** Current profile photo URL (Google or uploaded); null → initials. */
  avatarUrl: string | null;
  orgName: string | null;
  orgTier: string | null;
  orgType: OrgType | null;
  orgDescription: string | null;
  orgWebsite: string | null;
  orgLogoUrl: string | null;
  /** The active org's team (members + pending invites + viewer role). */
  orgTeam: OrgTeam;
  /** Signed-in user id — gates self-actions in the Organization section. */
  currentUserId: string;
  /** Proof of Truth profile status + completion, for the profile card. */
  proofStatus: 'in_progress' | 'complete';
  proofPct: number;
  proofMemberType: MemberType | null;
  /** Real Earn level + accumulated XP (from `profiles.xp` via getShellIdentity). */
  level: number;
  xp: number;
  /**
   * Admin surface access: 'platform' = Bey Group team (full portal + actions),
   * 'org' = an org owner/admin on their own workspace (read-only, org-scoped),
   * null = no admin section.
   */
  adminScope: 'platform' | 'org' | null;
  adminData: AdminData | null;
  invites: BetaInvite[];
  betaLinks: BetaLinkWithStatus[];
  /** Beta-link applicants (welcome-flow claimants) for the Applications inbox. */
  applications: BetaApplication[];
  /** Platform metrics for the Admin Knowledge / Chain-of-Trust panels. */
  adminMetrics: AdminMetrics | null;
  /** Referral + commission picture for the Admin Referrals panel + invite badges. */
  referralOverview: ReferralOverview | null;
  /** Configured commission ladder (tier → rate) for the Referrals panel copy. */
  referralTiers: ReferralTier[];
  /** Day-over-day launch momentum (deltas + series) for the Admin Overview. */
  launchTrend: LaunchTrend | null;
  /** The viewing admin's own role — gates owner-only role changes. */
  viewerRole: OrgMemberRole | null;
  /** Current plan/seat/status for the Plan & credits section. */
  subscription: OrgSubscription;
  /** Live wallet balance for the Plan & credits section. */
  creditBalance: number;
  /** Provider connections (merged with the catalog) for the Integrations section. */
  integrations: IntegrationView[];
}

/* ----------------------------------------------------------------------------
 * Gamification header
 * --------------------------------------------------------------------------*/

interface TrustStatus {
  label: string;
  icon: LucideIcon;
  earned: boolean;
}

/**
 * Derive the trust-status chips from the operator's REAL Proof-of-Truth state
 * rather than hardcoded `earned` flags. The first three milestones map to proof
 * completion (a real, server-sourced measure); "Capital Matched" and
 * "Institutional Grade" have no signal on this surface yet, so they render as
 * honest not-yet-earned aspirations.
 */
function deriveStatuses(proofStatus: 'in_progress' | 'complete', proofPct: number): TrustStatus[] {
  const complete = proofStatus === 'complete' || proofPct >= 100;
  return [
    { label: 'Verified Operator', icon: BadgeCheck, earned: proofPct >= 25 },
    { label: 'Execution Ready', icon: Zap, earned: proofPct >= 60 },
    { label: 'Trust Layer Complete', icon: ShieldCheck, earned: complete },
    { label: 'Capital Matched', icon: Sparkles, earned: false },
    { label: 'Institutional Grade', icon: BadgeCheck, earned: false }
  ];
}

const ACTION_INITIAL_STATE: SettingsActionState = { status: 'idle', message: '' };

function SaveButton({ pendingLabel = 'Saving...' }: { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button variant="primary" size="sm" type="submit" disabled={pending}>
      {pending ? pendingLabel : 'Save changes'}
    </Button>
  );
}

function ActionNotice({ state }: { state: SettingsActionState }) {
  if (state.status === 'idle') return null;
  const success = state.status === 'success';
  return (
    <p
      className={success ? 'text-[12px] text-success' : 'text-[12px] text-danger'}
      role={success ? 'status' : 'alert'}
    >
      {state.message}
    </p>
  );
}

function GamificationHeader({
  name,
  level,
  xp,
  proofStatus,
  proofPct
}: {
  name: string;
  level: number;
  xp: number;
  proofStatus: 'in_progress' | 'complete';
  proofPct: number;
}) {
  const statuses = deriveStatuses(proofStatus, proofPct);
  const earned = statuses.filter((s) => s.earned).length;
  // Within-level progress on the same curve `getShellIdentity` uses to derive
  // `level` (level N spans [(N-1)²·100, N²·100) XP), so the bar and the badge
  // always agree.
  const floor = (level - 1) ** 2 * 100;
  const ceil = level ** 2 * 100;
  const xpNext = ceil;
  const pct = Math.max(
    0,
    Math.min(100, Math.round(((xp - floor) / Math.max(1, ceil - floor)) * 100))
  );
  return (
    <Card className="overflow-hidden p-0" data-testid="settings-gamification">
      <div className="flex flex-col gap-5 bg-[linear-gradient(105deg,rgba(247,201,72,0.12),rgba(247,201,72,0.02)_46%,transparent_72%)] px-5 py-[18px]">
        <div className="flex items-center gap-4">
          <EarnCoin size={52} glow className="flex-none" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[16px] font-semibold tracking-[-0.015em] text-fg-1">
                {name}
              </span>
              <Badge tone="gold" className="px-2 py-px text-[10.5px] tabular-nums">
                Level {level}
              </Badge>
            </div>
            <p className="mt-1 text-[12.5px] text-fg-3">
              {earned} of {statuses.length} trust statuses earned · keep closing layers to reach
              Institutional Grade.
            </p>
          </div>
          <div className="hidden flex-none flex-col items-end sm:flex">
            <span className="text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-gold-1">
              {xp.toLocaleString()}
            </span>
            <span className="text-[10.5px] uppercase tracking-[0.11em] text-fg-4">XP</span>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-fg-4">
            <span>Progress to level {level + 1}</span>
            <span className="tabular-nums">
              {xp.toLocaleString()} / {xpNext.toLocaleString()} XP
            </span>
          </div>
          <ProgressBar value={pct} height={8} gradient="linear-gradient(90deg,#F7C948,#E5A823)" />
        </div>

        <div className="flex flex-wrap gap-2">
          {statuses.map((s) => {
            const Icon = s.icon;
            return (
              <span
                key={s.label}
                className={
                  s.earned
                    ? 'inline-flex items-center gap-1.5 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2.5 py-1 text-[11.5px] font-semibold text-gold-1'
                    : 'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-1 px-2.5 py-1 text-[11.5px] font-semibold text-fg-5'
                }
              >
                <Icon size={13} strokeWidth={1.9} aria-hidden />
                {s.label}
              </span>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------------------
 * Section primitives
 * --------------------------------------------------------------------------*/

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function ToggleRow({
  title,
  detail,
  defaultOn = false
}: {
  title: string;
  detail: string;
  defaultOn?: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-hairline bg-surface-1 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-fg-1">{title}</div>
        <div className="mt-0.5 text-[11.5px] text-fg-4">{detail}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        onClick={() => setOn((v) => !v)}
        className={
          on
            ? 'relative h-6 w-11 flex-none rounded-full bg-[linear-gradient(135deg,#3B74F0,#2152D8)] transition'
            : 'relative h-6 w-11 flex-none rounded-full bg-surface-3 transition'
        }
      >
        <span
          className={
            on
              ? 'absolute top-0.5 h-5 w-5 translate-x-[22px] rounded-full bg-white transition'
              : 'absolute top-0.5 h-5 w-5 translate-x-0.5 rounded-full bg-fg-3 transition'
          }
          aria-hidden
        />
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Section panels — unchanged behaviour, restructured into the right pane
 * --------------------------------------------------------------------------*/

function ProofOfTruthCard({
  status,
  pct,
  memberType
}: {
  status: 'in_progress' | 'complete';
  pct: number;
  memberType: MemberType | null;
}) {
  const complete = status === 'complete';
  const started = memberType != null || pct > 0;
  const cta = complete ? 'Edit profile' : started ? 'Resume profile' : 'Start profile';

  return (
    <Card>
      <SectionTitle eyebrow="Proof of Truth" title="Verified profile" />
      <div className="flex flex-col gap-4 rounded-xl border border-hairline bg-surface-1 px-4 py-3.5 sm:flex-row sm:items-center">
        <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
          <ShieldCheck size={19} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-fg-1">
              {memberType ? MEMBER_TYPE_LABELS[memberType] : 'Member profile'}
            </span>
            <Badge tone={complete ? 'success' : 'gold'} dot pulse={!complete}>
              {complete ? 'Complete' : 'In progress'}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11.5px] text-fg-4">
            {complete
              ? 'Your member-type-specific profile is published and verified.'
              : 'Earn helps you build your verified, member-type-specific profile.'}
          </p>
          <div className="mt-2.5">
            <div className="mb-1 flex items-center justify-between text-[11px] text-fg-4">
              <span>Completion</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <ProgressBar value={pct} height={6} gradient="linear-gradient(90deg,#F7C948,#E5A823)" />
          </div>
        </div>
        <Link
          href="/onboarding?edit=1"
          className="inline-flex flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-transparent bg-[linear-gradient(135deg,#3B74F0,#2152D8)] px-3 py-1.5 text-[12.5px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_18px_-8px_rgba(37,99,235,0.55)] transition hover:brightness-110"
        >
          {cta}
          <ArrowRight size={14} strokeWidth={1.9} aria-hidden />
        </Link>
      </div>
    </Card>
  );
}

function AvatarSection({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [state, formAction] = useActionState(updateAvatar, ACTION_INITIAL_STATE);
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-4">
        <SectionTitle eyebrow="Account" title="Profile photo" />
        <div className="flex items-center gap-4">
          <Avatar name={name} src={preview ?? avatarUrl} size={64} className="rounded-full" />
          <div className="min-w-0 flex-1">
            <label
              htmlFor="avatar-upload"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-3 py-1.5 text-[12.5px] font-medium text-fg-1 transition hover:bg-surface-2"
            >
              <User size={14} strokeWidth={1.9} aria-hidden />
              Choose photo
            </label>
            <input
              id="avatar-upload"
              type="file"
              name="avatar"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                setPreview(file ? URL.createObjectURL(file) : null);
              }}
            />
            <p className="mt-1.5 text-[11px] text-fg-4">
              PNG or JPG, up to 5&nbsp;MB. Falls back to your initials when unset.
            </p>
          </div>
          <SaveButton pendingLabel="Uploading..." />
        </div>
        <ActionNotice state={state} />
      </form>
    </Card>
  );
}

function AccountSection({
  email,
  fullName,
  role,
  bio,
  phone
}: {
  email: string | null;
  fullName: string | null;
  role: string | null;
  bio: string | null;
  phone: string | null;
}) {
  const [state, formAction] = useActionState(updateAccountSettings, ACTION_INITIAL_STATE);

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-4">
        <SectionTitle eyebrow="Account" title="Profile details" action={<SaveButton />} />
        <div className="flex flex-col gap-4">
          <FieldRow>
            <Input
              label="Full name"
              name="fullName"
              defaultValue={fullName ?? ''}
              placeholder="Your name"
              required
              maxLength={120}
            />
            <Input
              label="Role"
              name="role"
              defaultValue={role ?? ''}
              placeholder="e.g. Managing Partner"
              maxLength={120}
            />
          </FieldRow>
          <FieldRow>
            <Input label="Email" icon={Mail} defaultValue={email ?? ''} readOnly />
            <Input
              label="Phone"
              name="phone"
              icon={Phone}
              defaultValue={phone ?? ''}
              placeholder="+1 (555) 000-0000"
              maxLength={40}
            />
          </FieldRow>
          <Input
            label="Bio"
            name="bio"
            defaultValue={bio ?? ''}
            placeholder="A short institutional bio for your LP-facing profile."
            maxLength={2000}
          />
          <ActionNotice state={state} />
        </div>
      </form>
    </Card>
  );
}

function NotificationsSection() {
  return (
    <Card>
      <SectionTitle eyebrow="Notifications" title="What Earn surfaces" />
      <div className="flex flex-col gap-2.5">
        <ToggleRow
          title="Synergy alerts"
          detail="LP matches, capital fits, and warm-intro openings"
          defaultOn
        />
        <ToggleRow
          title="Deal-stage updates"
          detail="Chain-of-Trust layer changes on active deals"
          defaultOn
        />
        <ToggleRow
          title="Daily briefing"
          detail="Earn's ranked priorities, delivered each morning"
          defaultOn
        />
        <ToggleRow title="Product updates" detail="New brains, features, and platform notes" />
      </div>
    </Card>
  );
}

function SecuritySection() {
  return (
    <Card>
      <SectionTitle eyebrow="Security" title="Sign-in and sessions" />
      <div className="flex flex-col gap-5">
        <div>
          <p className="mb-3 max-w-prose text-[12px] leading-relaxed text-fg-3">
            Set or update your password so you can always sign in with your email — independent of
            Google or a one-time magic link. If you ever get logged out, this is your way straight
            back to where you left off.
          </p>
          <SetPasswordForm submitLabel="Update password" doneLabel="Password updated." />
        </div>
        <ToggleRow
          title="Two-factor authentication"
          detail="Require a one-time code at sign-in"
          defaultOn
        />
        <ToggleRow title="Trusted devices only" detail="Block sign-ins from new devices" />
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------------------
 * Vertical detail rail — left = section list, right = active section detail
 *
 * Wave-1 spec: settings render as a vertical detail rail with the capability
 * each section unlocks stated up front. Pattern: 240px sticky left column +
 * ~640px right detail pane (Notion / Linear / Stripe / Vercel style). The
 * active section gets a left-border accent + surface fill in the rail. URL
 * hash sync (`/settings#integrations`) lets sections be deep-linked.
 * --------------------------------------------------------------------------*/

interface SettingsSection {
  id:
    | 'account'
    | 'notifications'
    | 'security'
    | 'organization'
    | 'integrations'
    | 'billing'
    | 'trust'
    | 'admin';
  label: string;
  icon: LucideIcon;
  /** What completing this section unlocks across the app. */
  unlocks: string;
}

const SECTIONS: SettingsSection[] = [
  {
    id: 'account',
    label: 'Account',
    icon: User,
    unlocks: 'The identity Earn uses when speaking on your behalf — name, bio, contact.'
  },
  {
    id: 'trust',
    label: 'Trust profile',
    icon: ShieldCheck,
    unlocks: 'The Source-of-Truth proof package every LP probes before they commit.'
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    unlocks: 'What Earn surfaces in your day — synergy alerts, briefings, deal-stage signal.'
  },
  {
    id: 'security',
    label: 'Security',
    icon: Lock,
    unlocks: 'Sign-in policy, 2FA, and trusted-device controls for your workspace.'
  },
  {
    id: 'organization',
    label: 'Organization',
    icon: Building2,
    unlocks: 'Workspace identity + the institutional tier shown on LP-facing surfaces.'
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: Plug,
    unlocks: 'The tools Earn syncs from — Gmail, Calendar, Drive, Slack, Zoom and more.'
  },
  {
    id: 'billing',
    label: 'Plan & credits',
    icon: CreditCard,
    unlocks: 'The plan + Credit Wallet that fuels every AI workload Earn coordinates.'
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: Users,
    unlocks: 'Owner controls — members & roles, the audit log, and magic-link beta invites.'
  }
];

const VALID_IDS = new Set(SECTIONS.map((s) => s.id));

function hashToSection(hash: string): SettingsSection['id'] | null {
  const raw = hash.replace(/^#/, '').toLowerCase();
  return VALID_IDS.has(raw as SettingsSection['id']) ? (raw as SettingsSection['id']) : null;
}

export function SettingsView({
  email,
  fullName,
  role,
  bio,
  phone,
  avatarUrl,
  orgName,
  orgTier,
  orgType,
  orgDescription,
  orgWebsite,
  orgLogoUrl,
  orgTeam,
  currentUserId,
  proofStatus,
  proofPct,
  proofMemberType,
  level,
  xp,
  adminScope,
  adminData,
  invites,
  betaLinks,
  applications,
  adminMetrics,
  referralOverview,
  referralTiers,
  launchTrend,
  viewerRole,
  subscription,
  creditBalance,
  integrations
}: SettingsViewProps) {
  // The Admin section surfaces for platform admins (full) and org owners/admins
  // (read-only, org-scoped); hide it from the rail for everyone else.
  const isAdmin = adminScope != null;
  const visibleSections = SECTIONS.filter((s) => s.id !== 'admin' || isAdmin);
  // Lazy init — read the URL hash on first client render so deep links open
  // the right section without a flash. SSR returns 'account'; hydration runs
  // the lazy initializer on the client where `window` exists.
  const [active, setActive] = useState<SettingsSection['id']>(() => {
    if (typeof window === 'undefined') return 'account';
    return hashToSection(window.location.hash) ?? 'account';
  });

  // Subscribe to hash changes for cross-tab / browser-history navigation.
  // setState only fires inside the event handler — not during render or
  // synchronously inside the effect body.
  useEffect(() => {
    const onHash = () => {
      const next = hashToSection(window.location.hash);
      if (next) setActive(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function selectSection(id: SettingsSection['id']) {
    setActive(id);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.hash = id;
      window.history.replaceState(null, '', url.toString());
    }
  }

  const displayName = fullName ?? (email ? email.split('@')[0] : 'Your profile');
  const activeSection = visibleSections.find((s) => s.id === active) ?? visibleSections[0]!;
  const ActiveIcon = activeSection.icon;

  // The Admin rail copy depends on access tier: org owners/admins get a
  // read-only, org-scoped view, so promise that rather than the owner controls.
  const adminUnlocks =
    adminScope === 'org'
      ? 'Manage your team, roles, and invites, plus launch readiness and activity.'
      : SECTIONS.find((s) => s.id === 'admin')!.unlocks;
  const unlocksFor = (s: SettingsSection) => (s.id === 'admin' ? adminUnlocks : s.unlocks);

  return (
    <div className="flex flex-col gap-[22px]" data-testid="settings-rail-view">
      <GamificationHeader
        name={displayName}
        level={level}
        xp={xp}
        proofStatus={proofStatus}
        proofPct={proofPct}
      />

      <div className="grid gap-[18px] lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Sticky left rail — section list with capability copy */}
        <aside
          className="lg:sticky lg:top-[18px] lg:self-start"
          data-testid="settings-section-rail"
          aria-label="Settings sections"
        >
          <nav className="flex flex-col gap-1 rounded-2xl border border-hairline bg-bg-1 p-1.5">
            {visibleSections.map((s) => {
              const Icon = s.icon;
              const isActive = s.id === active;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectSection(s.id)}
                  aria-current={isActive ? 'page' : undefined}
                  data-testid={`settings-rail-${s.id}`}
                  className={cn(
                    'relative flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-[background,box-shadow,transform]',
                    isActive
                      ? 'bg-gradient-to-r from-[var(--azure-soft)] to-surface-1 text-fg-1'
                      : 'text-fg-3 hover:translate-x-0.5 hover:bg-surface-1'
                  )}
                >
                  {isActive ? (
                    <span
                      className="absolute -left-1.5 bottom-2 top-2 w-[3px] rounded-full bg-azure-1"
                      aria-hidden
                    />
                  ) : null}
                  <Icon
                    size={15}
                    strokeWidth={1.9}
                    className={cn('mt-0.5 flex-none', isActive ? 'text-azure-1' : 'text-fg-4')}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold leading-tight">
                      {s.label}
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 block text-[10.5px] leading-snug',
                        isActive ? 'text-fg-3' : 'text-fg-5'
                      )}
                    >
                      {unlocksFor(s)}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right detail pane — active section content */}
        <div
          className="flex max-w-[640px] flex-col gap-[18px]"
          data-testid={`settings-pane-${activeSection.id}`}
          key={activeSection.id}
        >
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-hairline bg-surface-1 text-azure-1">
              <ActiveIcon size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-4">
                Unlocks
              </p>
              <p className="mt-0.5 text-[13px] leading-snug text-fg-2">
                {unlocksFor(activeSection)}
              </p>
            </div>
          </div>

          {activeSection.id === 'account' && (
            <>
              <AvatarSection name={displayName} avatarUrl={avatarUrl} />
              <AccountSection
                email={email}
                fullName={fullName}
                role={role}
                bio={bio}
                phone={phone}
              />
            </>
          )}
          {activeSection.id === 'trust' && (
            <ProofOfTruthCard status={proofStatus} pct={proofPct} memberType={proofMemberType} />
          )}
          {activeSection.id === 'notifications' && <NotificationsSection />}
          {activeSection.id === 'security' && <SecuritySection />}
          {activeSection.id === 'organization' && (
            <OrganizationSection
              currentUserId={currentUserId}
              orgName={orgName}
              orgType={orgType}
              orgTier={orgTier}
              orgDescription={orgDescription}
              orgWebsite={orgWebsite}
              orgLogoUrl={orgLogoUrl}
              team={orgTeam}
              subscription={subscription}
            />
          )}
          {activeSection.id === 'integrations' && (
            <IntegrationsPanel connections={integrations} variant="settings" />
          )}
          {activeSection.id === 'billing' && (
            <PlanCreditsSection
              currentPlan={subscription.plan}
              currentInterval={subscription.interval}
              seats={subscription.seats}
              status={subscription.status}
              cancelAtPeriodEnd={subscription.cancelAtPeriodEnd}
              currentPeriodEnd={subscription.currentPeriodEnd}
              hasSubscription={subscription.configured}
              creditBalance={creditBalance}
            />
          )}
          {activeSection.id === 'admin' && isAdmin && adminData && (
            <AdminView
              scope={adminScope === 'org' ? 'org' : 'platform'}
              data={adminData}
              invites={invites}
              betaLinks={betaLinks}
              applications={applications}
              metrics={adminMetrics}
              referralOverview={referralOverview}
              referralTiers={referralTiers}
              launchTrend={launchTrend}
              viewerRole={viewerRole}
            />
          )}
        </div>
      </div>
    </div>
  );
}
