'use client';

import { useState } from 'react';
import {
  Users,
  UserPlus,
  Activity,
  Check,
  UserCog,
  Archive,
  Shield,
  BrainCircuit,
  Globe,
  Building2,
  GitBranch,
  Upload,
  ChevronRight,
  type LucideIcon
} from 'lucide-react';
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
import { TONE_HEX } from '@/components/screens/tone';
import type { AdminData, AdminMember } from '@/lib/queries/admin';

type MemberStatus = AdminMember['status'] | 'Archived';

const STATUS_TONE: Record<MemberStatus, BadgeTone> = {
  Active: 'success',
  Pending: 'warning',
  Archived: 'neutral'
};

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member'
};

interface Stat {
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
  tone: BadgeTone;
}

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
  members,
  statuses,
  onSetStatus
}: {
  members: AdminMember[];
  statuses: Record<string, MemberStatus>;
  onSetStatus: (id: string, status: MemberStatus) => void;
}) {
  if (members.length === 0) {
    return (
      <Card className="p-10 text-center text-[13px] text-fg-5">
        No members in this organization.
      </Card>
    );
  }
  return (
    <Card className="p-2">
      <div className="grid grid-cols-[1.8fr_1.2fr_0.9fr_1.1fr] gap-2 px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        <span>Member</span>
        <span>Role</span>
        <span>Status</span>
        <span>Actions</span>
      </div>
      <div className="h-px bg-hairline" />
      {members.map((m, i) => {
        const tone: AvatarTone = i % 2 ? 'gold' : 'azure';
        const status = statuses[m.id] ?? m.status;
        return (
          <div
            key={m.id}
            className="grid grid-cols-[1.8fr_1.2fr_0.9fr_1.1fr] items-center gap-2 border-b border-hairline-faint px-3 py-2.5 last:border-b-0"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name={m.name} size={30} tone={tone} />
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-fg-1">{m.name}</div>
              </div>
            </div>
            <span className="text-xs text-fg-2">{ROLE_LABEL[m.role] ?? m.role}</span>
            <div>
              <Badge tone={STATUS_TONE[status]} className="text-[10px]">
                {status}
              </Badge>
            </div>
            <div className="flex gap-1.5">
              {status === 'Pending' && (
                <button
                  type="button"
                  title="Approve"
                  aria-label="Approve"
                  onClick={() => onSetStatus(m.id, 'Active')}
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
                onClick={() => onSetStatus(m.id, 'Archived')}
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

function ActivityPanel({ actions }: { actions: AdminData['actions'] }) {
  return (
    <Card className="p-2">
      <div className="grid grid-cols-[1.6fr_1fr_1fr_0.6fr] gap-2 px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        <span>Action</span>
        <span>Target</span>
        <span>Actor</span>
        <span className="text-right">When</span>
      </div>
      <div className="h-px bg-hairline" />
      {actions.length === 0 ? (
        <div className="p-10 text-center text-[13px] text-fg-5">No recent admin activity.</div>
      ) : (
        actions.map((a) => (
          <div
            key={a.id}
            className="grid grid-cols-[1.6fr_1fr_1fr_0.6fr] items-center gap-2 border-b border-hairline-faint px-3 py-2.5 last:border-b-0"
          >
            <span className="truncate text-[12.5px] font-medium text-fg-1">{a.actionType}</span>
            <span className="truncate text-xs text-fg-3">{a.targetType ?? '—'}</span>
            <span className="truncate text-xs text-fg-2">{a.actor}</span>
            <span className="text-right font-mono text-[11px] tabular-nums text-fg-5">
              {a.time}
            </span>
          </div>
        ))
      )}
    </Card>
  );
}

function KnowledgePanel({ brains }: { brains: AdminData['brains'] }) {
  const globalCount = brains.filter((b) => b.scope === 'Global').length;
  const orgCount = brains.filter((b) => b.scope === 'Org').length;

  const stats: Stat[] = [
    {
      label: 'AI brains',
      value: String(brains.length),
      sub: 'Specialized modules',
      icon: BrainCircuit,
      tone: 'gold'
    },
    {
      label: 'Global brains',
      value: String(globalCount),
      sub: 'Platform-wide',
      icon: Globe,
      tone: 'azure'
    },
    {
      label: 'Org brains',
      value: String(orgCount),
      sub: 'This organization',
      icon: Building2,
      tone: 'success'
    }
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex gap-3.5">
        {stats.map((s) => (
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
        {brains.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-fg-5">No AI brains configured yet.</p>
        ) : (
          <div className="grid gap-2.5 lg:grid-cols-2">
            {brains.map((b) => (
              <button
                key={b.id}
                type="button"
                className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 p-3 text-left transition hover:bg-surface-2"
              >
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-gold-1">
                  <BrainCircuit size={16} strokeWidth={1.9} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-fg-1">{b.name}</div>
                  <div className="truncate text-[10.5px] text-fg-5">{b.description ?? b.slug}</div>
                </div>
                <Badge tone={b.scope === 'Global' ? 'azure' : 'success'} className="text-[9.5px]">
                  {b.scope}
                </Badge>
              </button>
            ))}
          </div>
        )}
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

export function AdminView({ data }: { data: AdminData }) {
  const [tab, setTab] = useState<Tab>('users');
  const [statuses, setStatuses] = useState<Record<string, MemberStatus>>({});

  function setStatus(id: string, status: MemberStatus) {
    setStatuses((prev) => ({ ...prev, [id]: status }));
  }

  const activeCount = data.members.filter((m) => (statuses[m.id] ?? m.status) === 'Active').length;
  const pendingCount = data.members.filter(
    (m) => (statuses[m.id] ?? m.status) === 'Pending'
  ).length;

  const adminStats: Stat[] = [
    {
      label: 'Members',
      value: String(data.members.length),
      sub: `${activeCount} active`,
      icon: Users,
      tone: 'azure'
    },
    {
      label: 'Pending approval',
      value: String(pendingCount),
      sub: pendingCount ? 'Action needed' : 'All clear',
      icon: UserPlus,
      tone: 'warning'
    },
    {
      label: 'AI brains',
      value: String(data.brains.length),
      sub: 'Knowledge modules',
      icon: BrainCircuit,
      tone: 'gold'
    },
    {
      label: 'Recent actions',
      value: String(data.actions.length),
      sub: 'Admin audit log',
      icon: Activity,
      tone: 'success'
    }
  ];

  return (
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
          {adminStats.map((s) => (
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

      {tab === 'users' && (
        <UsersPanel members={data.members} statuses={statuses} onSetStatus={setStatus} />
      )}
      {tab === 'activity' && <ActivityPanel actions={data.actions} />}
      {tab === 'knowledge' && <KnowledgePanel brains={data.brains} />}
    </div>
  );
}
