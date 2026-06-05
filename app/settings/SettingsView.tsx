'use client';

import { useState } from 'react';
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
  Zap,
  type LucideIcon
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Input,
  ProgressBar,
  SectionTitle,
  SegTabs,
  Select,
  type BadgeTone,
  type TabItem
} from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';

interface SettingsViewProps {
  email: string | null;
  fullName: string | null;
  role: string | null;
  orgName: string | null;
  orgTier: string | null;
  /** Proof of Truth profile status + completion, for the profile card. */
  proofStatus: 'in_progress' | 'complete';
  proofPct: number;
  proofMemberType: MemberType | null;
}

// ── Gamification ──────────────────────────────────────────────────────────────

interface TrustStatus {
  label: string;
  icon: LucideIcon;
  earned: boolean;
}

const STATUSES: TrustStatus[] = [
  { label: 'Verified Operator', icon: BadgeCheck, earned: true },
  { label: 'Execution Ready', icon: Zap, earned: true },
  { label: 'Trust Layer Complete', icon: ShieldCheck, earned: true },
  { label: 'Capital Matched', icon: Sparkles, earned: false },
  { label: 'Institutional Grade', icon: BadgeCheck, earned: false }
];

const LEVEL = 7;
const XP = 4820;
const XP_NEXT = 6000;

function GamificationHeader({ name }: { name: string }) {
  const earned = STATUSES.filter((s) => s.earned).length;
  const pct = Math.round((XP / XP_NEXT) * 100);
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-5 bg-[linear-gradient(105deg,rgba(247,201,72,0.12),rgba(247,201,72,0.02)_46%,transparent_72%)] px-5 py-[18px]">
        <div className="flex items-center gap-4">
          <EarnCoin size={52} glow className="flex-none" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[16px] font-semibold tracking-[-0.015em] text-fg-1">
                {name}
              </span>
              <Badge tone="gold" className="px-2 py-px text-[10.5px] tabular-nums">
                Level {LEVEL}
              </Badge>
            </div>
            <p className="mt-1 text-[12.5px] text-fg-3">
              {earned} of {STATUSES.length} trust statuses earned · keep closing layers to reach
              Institutional Grade.
            </p>
          </div>
          <div className="hidden flex-none flex-col items-end sm:flex">
            <span className="text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-gold-1">
              {XP.toLocaleString()}
            </span>
            <span className="text-[10.5px] uppercase tracking-[0.11em] text-fg-4">XP</span>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-fg-4">
            <span>Progress to level {LEVEL + 1}</span>
            <span className="tabular-nums">
              {XP.toLocaleString()} / {XP_NEXT.toLocaleString()} XP
            </span>
          </div>
          <ProgressBar value={pct} height={8} gradient="linear-gradient(90deg,#F7C948,#E5A823)" />
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => {
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

// ── Section primitives ────────────────────────────────────────────────────────

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

// ── Section panels ────────────────────────────────────────────────────────────

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

function AccountSection({
  email,
  fullName,
  role
}: {
  email: string | null;
  fullName: string | null;
  role: string | null;
}) {
  return (
    <Card>
      <SectionTitle
        eyebrow="Account"
        title="Profile details"
        action={
          <Button variant="primary" size="sm">
            Save changes
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <FieldRow>
          <Input label="Full name" defaultValue={fullName ?? ''} placeholder="Your name" />
          <Input label="Role" defaultValue={role ?? ''} placeholder="e.g. Managing Partner" />
        </FieldRow>
        <FieldRow>
          <Input label="Email" icon={Mail} defaultValue={email ?? ''} readOnly />
          <Input label="Phone" icon={Phone} placeholder="+1 (555) 000-0000" />
        </FieldRow>
        <Input label="Bio" placeholder="A short institutional bio for your LP-facing profile." />
      </div>
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
  orgTier
}: {
  orgName: string | null;
  orgTier: string | null;
}) {
  return (
    <Card>
      <SectionTitle
        eyebrow="Organization"
        title="Workspace"
        action={
          <Button variant="primary" size="sm">
            Save changes
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <FieldRow>
          <Input
            label="Organization name"
            icon={Building2}
            defaultValue={orgName ?? ''}
            placeholder="Your organization"
          />
          <Select
            label="Organization type"
            defaultValue="fund"
            options={[
              { value: 'fund', label: 'Fund' },
              { value: 'lp', label: 'Limited partner' },
              { value: 'operator', label: 'Operator' },
              { value: 'capital_provider', label: 'Capital provider' },
              { value: 'service_provider', label: 'Service provider' },
              { value: 'partner', label: 'Partner' }
            ]}
          />
        </FieldRow>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-hairline bg-surface-1 px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold text-fg-1">Tier</div>
            <div className="mt-0.5 text-[11.5px] text-fg-4">Current institutional standing</div>
          </div>
          <Badge tone="info">{orgTier ?? 'Emerging manager'}</Badge>
        </div>
      </div>
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

// ── View ──────────────────────────────────────────────────────────────────────

const TABS: TabItem[] = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'organization', label: 'Organization', icon: Building2 },
  { id: 'billing', label: 'Billing', icon: CreditCard }
];

export function SettingsView({
  email,
  fullName,
  role,
  orgName,
  orgTier,
  proofStatus,
  proofPct,
  proofMemberType
}: SettingsViewProps) {
  const [tab, setTab] = useState('account');
  const displayName = fullName ?? (email ? email.split('@')[0] : 'Your profile');

  return (
    <div className="flex flex-col gap-[22px]">
      <GamificationHeader name={displayName} />

      <SegTabs tabs={TABS} active={tab} onChange={setTab} className="flex-wrap" />

      {tab === 'account' && (
        <>
          <ProofOfTruthCard status={proofStatus} pct={proofPct} memberType={proofMemberType} />
          <AccountSection email={email} fullName={fullName} role={role} />
        </>
      )}
      {tab === 'notifications' && <NotificationsSection />}
      {tab === 'security' && <SecuritySection />}
      {tab === 'organization' && <OrganizationSection orgName={orgName} orgTier={orgTier} />}
      {tab === 'billing' && <BillingSection />}
    </div>
  );
}
