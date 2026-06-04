'use client';

import { useState } from 'react';
import {
  Users,
  UserPlus,
  Wallet,
  AlertTriangle,
  Activity,
  Check,
  UserCog,
  Archive,
  Shield,
  BrainCircuit,
  FileText,
  Layers,
  Clock,
  Upload,
  GitBranch,
  TrendingUp,
  Briefcase,
  ChevronRight,
  type LucideIcon
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import {
  Avatar,
  Badge,
  Button,
  Card,
  SectionTitle,
  SegTabs,
  type AvatarTone,
  type BadgeTone
} from '@/components/ui';
import { BRAINS, type BrainStatus } from '@/components/screens/brains';
import { TONE_HEX } from '@/components/screens/tone';

/* ---- Mock data — shaped to mirror a platform `users` table ---- */

type UserStatus = 'Active' | 'Pending' | 'Archived';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  org: string;
  role: string;
  status: UserStatus;
}

const SEED_USERS: AdminUser[] = [
  {
    id: 'u-1',
    name: 'Jordan Avery',
    email: 'jordan@acmecapital.com',
    org: 'Acme Capital',
    role: 'Managing Partner',
    status: 'Active'
  },
  {
    id: 'u-2',
    name: 'Priya Mensah',
    email: 'priya@acmecapital.com',
    org: 'Acme Capital',
    role: 'Principal',
    status: 'Active'
  },
  {
    id: 'u-3',
    name: 'Daniel Cho',
    email: 'daniel@meridianfo.com',
    org: 'Meridian FO',
    role: 'LP / Allocator',
    status: 'Pending'
  },
  {
    id: 'u-4',
    name: 'Sara Lindqvist',
    email: 'sara@sterlingpc.com',
    org: 'Sterling Private Credit',
    role: 'Capital Provider',
    status: 'Pending'
  },
  {
    id: 'u-5',
    name: 'Marcus Webb',
    email: 'marcus@orioncpa.com',
    org: 'Orion CPA Group',
    role: 'Service Provider',
    status: 'Archived'
  }
];

const STATUS_TONE: Record<UserStatus, BadgeTone> = {
  Active: 'success',
  Pending: 'warning',
  Archived: 'neutral'
};

const BRAIN_STATUS_TONE: Record<BrainStatus, BadgeTone> = {
  Active: 'success',
  Review: 'warning',
  Draft: 'neutral'
};

interface Stat {
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
  tone: BadgeTone;
}

const ADMIN_STATS: Stat[] = [
  { label: 'Total users', value: '142', sub: '+6 this week', icon: Users, tone: 'azure' },
  { label: 'Pending approval', value: '2', sub: 'Action needed', icon: UserPlus, tone: 'warning' },
  {
    label: 'Capital deployed',
    value: '$612M',
    sub: 'Platform-wide',
    icon: Wallet,
    tone: 'success'
  },
  {
    label: 'Critical-risk items',
    value: '2',
    sub: 'Legal / Admin queue',
    icon: AlertTriangle,
    tone: 'danger'
  }
];

const KB_STATS: Stat[] = [
  { label: 'AI brains', value: '15', sub: 'Specialized modules', icon: BrainCircuit, tone: 'gold' },
  {
    label: 'Knowledge docs',
    value: '115',
    sub: 'Across all brains',
    icon: FileText,
    tone: 'azure'
  },
  {
    label: 'Chunks embedded',
    value: '3,852',
    sub: 'pgvector · 1536-dim',
    icon: Layers,
    tone: 'success'
  },
  { label: 'Pending review', value: '2', sub: 'Awaiting approval', icon: Clock, tone: 'warning' }
];

interface ActivityGroup {
  title: string;
  icon: LucideIcon;
  rows: Array<[string, string]>;
}

const ACTIVITY: ActivityGroup[] = [
  {
    title: 'Deal activity',
    icon: TrendingUp,
    rows: [
      ['Atlas closing', '$32M'],
      ['Helios diligence', '$4.5M'],
      ['Cedar IC review', '$11M']
    ]
  },
  {
    title: 'Partner activity',
    icon: Briefcase,
    rows: [
      ['Sterling matched', 'Capital'],
      ['Whitman engaged', 'Legal'],
      ['Orion intro', 'CPA']
    ]
  },
  {
    title: 'Capital deployment',
    icon: Wallet,
    rows: [
      ['Meridian wire', '$6M'],
      ['Granite soft-circle', '$10M'],
      ['Halcyon close', '$4M']
    ]
  }
];

const PIPELINE_STEPS = [
  'Intake',
  'Scrub',
  'Classify',
  'Score',
  'Route',
  'Process',
  'Synthesize',
  'Output',
  'Execute',
  'Track',
  'Optimize'
];

type Tab = 'users' | 'activity' | 'knowledge';

function StatTile({ stat }: { stat: Stat }) {
  const Icon = stat.icon;
  return (
    <Card className="flex-1 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          {stat.label}
        </span>
        <span style={{ color: TONE_HEX[stat.tone] }}>
          <Icon size={15} strokeWidth={1.9} aria-hidden />
        </span>
      </div>
      <div className="mt-3 text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
        {stat.value}
      </div>
      <div className="mt-1 text-[11px] text-fg-5">{stat.sub}</div>
    </Card>
  );
}

function UsersPanel({
  users,
  onSetStatus
}: {
  users: AdminUser[];
  onSetStatus: (id: string, status: UserStatus) => void;
}) {
  return (
    <Card className="p-2">
      <div className="grid grid-cols-[1.4fr_1.4fr_1.2fr_0.8fr_1.1fr] gap-2 px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        <span>User</span>
        <span>Organization</span>
        <span>Role</span>
        <span>Status</span>
        <span>Actions</span>
      </div>
      <div className="h-px bg-hairline" />
      {users.map((u, i) => {
        const tone: AvatarTone = i % 2 ? 'gold' : 'azure';
        return (
          <div
            key={u.id}
            className="grid grid-cols-[1.4fr_1.4fr_1.2fr_0.8fr_1.1fr] items-center gap-2 border-b border-hairline-faint px-3 py-2.5 last:border-b-0"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name={u.name} size={30} tone={tone} />
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-fg-1">{u.name}</div>
                <div className="truncate text-[10.5px] text-fg-5">{u.email}</div>
              </div>
            </div>
            <span className="text-xs text-fg-3">{u.org}</span>
            <span className="text-xs text-fg-2">{u.role}</span>
            <div>
              <Badge tone={STATUS_TONE[u.status]} className="text-[10px]">
                {u.status}
              </Badge>
            </div>
            <div className="flex gap-1.5">
              {u.status === 'Pending' && (
                <button
                  type="button"
                  title="Approve"
                  aria-label="Approve"
                  onClick={() => onSetStatus(u.id, 'Active')}
                  className="flex h-[27px] w-[27px] items-center justify-center rounded-md border border-[var(--success-line)] bg-[var(--success-soft)] text-success transition hover:brightness-110"
                >
                  <Check size={13} strokeWidth={1.9} aria-hidden />
                </button>
              )}
              <button
                type="button"
                title="Assign role"
                aria-label="Assign role"
                className="flex h-[27px] w-[27px] items-center justify-center rounded-md border border-hairline bg-surface-1 text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
              >
                <UserCog size={13} strokeWidth={1.9} aria-hidden />
              </button>
              <button
                type="button"
                title="Archive"
                aria-label="Archive"
                onClick={() => onSetStatus(u.id, 'Archived')}
                className="flex h-[27px] w-[27px] items-center justify-center rounded-md border border-hairline bg-surface-1 text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
              >
                <Archive size={13} strokeWidth={1.9} aria-hidden />
              </button>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function ActivityPanel() {
  return (
    <div className="grid gap-[18px] lg:grid-cols-3">
      {ACTIVITY.map((group) => {
        const Icon = group.icon;
        return (
          <Card key={group.title}>
            <SectionTitle
              title={group.title}
              className="mb-3"
              action={<Icon size={15} strokeWidth={1.9} className="text-fg-4" aria-hidden />}
            />
            <div className="flex flex-col">
              {group.rows.map(([a, b]) => (
                <div
                  key={a}
                  className="flex items-center justify-between rounded-lg px-1 py-2 transition hover:bg-surface-1"
                >
                  <span className="text-[12.5px] text-fg-2">{a}</span>
                  <span className="font-mono text-[11.5px] tabular-nums text-fg-4">{b}</span>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function KnowledgePanel() {
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex gap-3.5">
        {KB_STATS.map((s) => (
          <StatTile key={s.label} stat={s} />
        ))}
      </div>

      <Card>
        <SectionTitle
          eyebrow="pgvector knowledge store"
          title="AI brains & knowledge sources"
          action={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" icon={GitBranch}>
                Routing rules
              </Button>
              <Button variant="primary" size="sm" icon={Upload}>
                Upload knowledge
              </Button>
            </div>
          }
        />
        <div className="grid gap-2.5 lg:grid-cols-2">
          {BRAINS.map((b) => {
            const Icon = b.icon;
            return (
              <button
                key={b.slug}
                type="button"
                className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 p-3 text-left transition hover:bg-surface-2"
              >
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-gold-1">
                  <Icon size={16} strokeWidth={1.9} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-fg-1">{b.name}</div>
                  <div className="text-[10.5px] tabular-nums text-fg-5">
                    {b.docs} docs · {b.chunks.toLocaleString()} chunks
                  </div>
                </div>
                <Badge tone={BRAIN_STATUS_TONE[b.status]} className="text-[9.5px]">
                  {b.status}
                </Badge>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <SectionTitle title="Intake → route → execute" className="mb-3" />
        <div className="flex flex-wrap items-center gap-1.5">
          {PIPELINE_STEPS.map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[11.5px] font-medium text-fg-2">
                {s}
              </span>
              {i < PIPELINE_STEPS.length - 1 && (
                <ChevronRight size={13} strokeWidth={1.9} className="text-fg-5" aria-hidden />
              )}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<AdminUser[]>(SEED_USERS);

  function setStatus(id: string, status: UserStatus) {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status } : u)));
  }

  return (
    <AppShell title="Admin Portal" subtitle="Bey Group International">
      <div className="flex flex-col gap-[18px]">
        <div className="flex items-end justify-between">
          <SectionTitle eyebrow="Platform administration" title="Admin Portal" className="mb-0" />
          <Badge tone="gold" dot>
            <span className="inline-flex items-center gap-1.5">
              <Shield size={11} strokeWidth={1.9} aria-hidden />
              Admin access
            </span>
          </Badge>
        </div>

        {tab !== 'knowledge' && (
          <div className="flex gap-3.5">
            {ADMIN_STATS.map((s) => (
              <StatTile key={s.label} stat={s} />
            ))}
          </div>
        )}

        <SegTabs
          active={tab}
          onChange={(id) => setTab(id as Tab)}
          tabs={[
            { id: 'users', label: 'Users & roles', icon: Users },
            { id: 'activity', label: 'Activity', icon: Activity },
            { id: 'knowledge', label: 'Knowledge Base', icon: BrainCircuit }
          ]}
        />

        {tab === 'users' && <UsersPanel users={users} onSetStatus={setStatus} />}
        {tab === 'activity' && <ActivityPanel />}
        {tab === 'knowledge' && <KnowledgePanel />}
      </div>
    </AppShell>
  );
}
