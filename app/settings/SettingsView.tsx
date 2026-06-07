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
  ShieldCheck,
  Sparkles,
  User,
  Users,
  Zap,
  type LucideIcon
} from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Input,
  ProgressBar,
  SectionTitle,
  Select,
  type BadgeTone
} from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';
import type { Database } from '@/lib/supabase/database.types';
import { cn } from '@/lib/utils';
import { AdminView } from '@/app/admin/AdminView';
import type { AdminData } from '@/lib/queries/admin';
import type { AdminMetrics } from '@/lib/queries/admin-metrics';
import type { BetaInvite } from '@/lib/queries/beta-invites';
import type { BetaLinkWithStatus } from '@/lib/queries/beta-links';
import type { BetaApplication } from '@/lib/queries/beta-applications';
import {
  updateAccountSettings,
  updateAvatar,
  updateOrganizationSettings,
  type SettingsActionState
} from './actions';

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
  /** Proof of Truth profile status + completion, for the profile card. */
  proofStatus: 'in_progress' | 'complete';
  proofPct: number;
  proofMemberType: MemberType | null;
  /** Real Earn level + accumulated XP (from `profiles.xp` via getShellIdentity). */
  level: number;
  xp: number;
  /** Owner/admin only — surfaces the Admin section (members, roles, beta invites). */
  isAdmin: boolean;
  adminData: AdminData | null;
  invites: BetaInvite[];
  betaLinks: BetaLinkWithStatus[];
  /** Beta-link applicants (welcome-flow claimants) for the Applications inbox. */
  applications: BetaApplication[];
  /** Platform metrics for the Admin Knowledge / Chain-of-Trust panels. */
  adminMetrics: AdminMetrics | null;
  /** The viewing admin's own role — gates owner-only role changes. */
  viewerRole: OrgMemberRole | null;
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

const ORG_OPTIONS: Array<{ value: OrgType; label: string }> = [
  { value: 'fund', label: 'Fund' },
  { value: 'lp', label: 'Limited partner' },
  { value: 'operator', label: 'Operator' },
  { value: 'capital_provider', label: 'Capital provider' },
  { value: 'service_provider', label: 'Service provider' },
  { value: 'partner', label: 'Partner' }
];

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
          href="/onboarding"
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
      <SectionTitle
        eyebrow="Security"
        title="Sign-in and sessions"
        action={
          <Button variant="primary" size="sm">
            Update password
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <FieldRow>
          <Input label="Current password" type="password" icon={Lock} placeholder="••••••••" />
          <Input label="New password" type="password" icon={Lock} placeholder="••••••••" />
        </FieldRow>
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

function OrganizationSection({
  orgName,
  orgTier,
  orgType
}: {
  orgName: string | null;
  orgTier: string | null;
  orgType: OrgType | null;
}) {
  const [state, formAction] = useActionState(updateOrganizationSettings, ACTION_INITIAL_STATE);

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-4">
        <SectionTitle eyebrow="Organization" title="Workspace" action={<SaveButton />} />
        <div className="flex flex-col gap-4">
          <FieldRow>
            <Input
              label="Organization name"
              name="orgName"
              icon={Building2}
              defaultValue={orgName ?? ''}
              placeholder="Your organization"
              required
              maxLength={120}
            />
            <Select
              label="Organization type"
              name="orgType"
              defaultValue={orgType ?? 'fund'}
              options={ORG_OPTIONS}
            />
          </FieldRow>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-hairline bg-surface-1 px-4 py-3">
            <div>
              <div className="text-[13px] font-semibold text-fg-1">Tier</div>
              <div className="mt-0.5 text-[11.5px] text-fg-4">Current institutional standing</div>
            </div>
            <Badge tone="info">{orgTier ?? 'Emerging manager'}</Badge>
          </div>
          <ActionNotice state={state} />
        </div>
      </form>
    </Card>
  );
}

interface Plan {
  name: string;
  price: string;
  detail: string;
  tone: BadgeTone;
  current: boolean;
}

const PLANS: Plan[] = [
  {
    name: 'Operator',
    price: '$0',
    detail: 'Single workspace, core Earn',
    tone: 'neutral',
    current: false
  },
  {
    name: 'Fund',
    price: '$490',
    detail: '15 brains, Chain of Trust',
    tone: 'azure',
    current: true
  },
  {
    name: 'Institutional',
    price: 'Custom',
    detail: 'SSO, audit, dedicated brains',
    tone: 'gold',
    current: false
  }
];

function BillingSection() {
  return (
    <Card>
      <SectionTitle
        eyebrow="Billing"
        title="Plan and invoices"
        action={
          <Button variant="primary" size="sm" icon={CreditCard}>
            Manage billing
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {PLANS.map((p) => (
          <div
            key={p.name}
            className={
              p.current
                ? 'rounded-xl border border-[var(--accent-line)] bg-surface-2 p-4'
                : 'rounded-xl border border-hairline bg-surface-1 p-4'
            }
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-fg-1">{p.name}</span>
              {p.current && (
                <Badge tone="azure" className="px-2 py-0.5 text-[10px]">
                  Current
                </Badge>
              )}
            </div>
            <div className="mt-2 text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
              {p.price}
              <span className="ml-1 text-[11.5px] font-medium text-fg-5">/mo</span>
            </div>
            <p className="mt-1 text-[11.5px] text-fg-4">{p.detail}</p>
          </div>
        ))}
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
  id: 'account' | 'notifications' | 'security' | 'organization' | 'billing' | 'trust' | 'admin';
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
    id: 'billing',
    label: 'Billing & credits',
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
  proofStatus,
  proofPct,
  proofMemberType,
  level,
  xp,
  isAdmin,
  adminData,
  invites,
  betaLinks,
  applications,
  adminMetrics,
  viewerRole
}: SettingsViewProps) {
  // The Admin section is owner/admin-only; hide it from the rail otherwise.
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
                      {s.unlocks}
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
              <p className="mt-0.5 text-[13px] leading-snug text-fg-2">{activeSection.unlocks}</p>
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
            <OrganizationSection orgName={orgName} orgTier={orgTier} orgType={orgType} />
          )}
          {activeSection.id === 'billing' && <BillingSection />}
          {activeSection.id === 'admin' && isAdmin && adminData && (
            <AdminView
              data={adminData}
              invites={invites}
              betaLinks={betaLinks}
              applications={applications}
              metrics={adminMetrics}
              viewerRole={viewerRole}
            />
          )}
        </div>
      </div>
    </div>
  );
}
