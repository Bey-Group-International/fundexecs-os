'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCardState } from '@/lib/ui/useCardState';
import { approveMember, archiveMember } from '@/lib/actions/admin';
import {
  Users,
  UserPlus,
  Activity,
  Check,
  UserCog,
  Archive,
  Shield,
  BrainCircuit,
  Database,
  Layers,
  GitBranch,
  Upload,
  Sparkles,
  ShieldCheck,
  Bell,
  CircleCheck,
  CircleDot,
  type LucideIcon
} from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ProgressBar,
  SectionTitle,
  SegTabs,
  type AvatarTone,
  type BadgeTone
} from '@/components/ui';
import { TONE_HEX } from '@/components/screens/tone';
import { TEAM_ROSTER, TeamAvatar } from '@/lib/team';
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

/** Chain-of-Trust verification layers shown on the oversight panel. */
const TRUST_LAYERS: Array<{
  no: string;
  name: string;
  desc: string;
  value: number;
  tone: BadgeTone;
}> = [
  {
    no: '01',
    name: 'Proof of truth',
    desc: 'Source data, citations, verified facts',
    value: 100,
    tone: 'success'
  },
  {
    no: '02',
    name: 'Proof of concept',
    desc: 'Strategy, thesis, fit logic',
    value: 70,
    tone: 'gold'
  },
  {
    no: '03',
    name: 'Proof of execution',
    desc: 'Tasks, workflows, approvals',
    value: 35,
    tone: 'warning'
  },
  {
    no: '04',
    name: 'Proof of work',
    desc: 'Evidence, uploads, outcomes, logs',
    value: 0,
    tone: 'neutral'
  }
];

/** Platform notifications surfaced to admins. */
const NOTIFICATIONS: Array<{ title: string; detail: string; tone: BadgeTone }> = [
  {
    title: 'Vector index optimized',
    detail: 'pgvector reindex completed across 14 brains',
    tone: 'success'
  },
  {
    title: 'New knowledge intake',
    detail: '3 documents queued for embedding',
    tone: 'azure'
  },
  {
    title: 'Approval pending',
    detail: 'Chain-of-Trust review needs a human sign-off',
    tone: 'warning'
  }
];

type Tab = 'users' | 'activity' | 'trust' | 'knowledge';

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
    <div className="grid items-start gap-[18px] lg:grid-cols-[1fr_320px]">
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

      <Card>
        <SectionTitle
          eyebrow="Platform"
          title="Notifications"
          className="mb-3"
          action={<Bell size={15} strokeWidth={1.9} className="text-fg-4" aria-hidden />}
        />
        <div className="flex flex-col gap-2.5">
          {NOTIFICATIONS.map((n) => (
            <div
              key={n.title}
              className="flex items-start gap-2.5 rounded-xl border border-hairline bg-surface-1 p-3"
            >
              <span className="mt-0.5 flex-none" style={{ color: TONE_HEX[n.tone] }}>
                <CircleDot size={13} strokeWidth={1.9} aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-fg-1">{n.title}</div>
                <div className="text-[11px] text-fg-4">{n.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function TrustPanel() {
  const verified = 51;
  return (
    <div className="flex flex-col gap-[18px]">
      <Card className="bg-[linear-gradient(100deg,rgba(52,211,153,0.07),transparent_60%)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-hairline bg-surface-2 text-success">
              <ShieldCheck size={18} strokeWidth={1.9} aria-hidden />
            </span>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Chain of trust
              </div>
              <div className="flex items-center gap-2 text-[15px] font-semibold text-fg-1">
                Atlas Manufacturing
                <Badge tone="success" className="text-[9.5px]">
                  M&amp;A · Closing
                </Badge>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[22px] font-semibold tabular-nums text-success">{verified}%</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Verified
            </div>
          </div>
        </div>
        <div className="mt-3 text-[12px] text-fg-4">
          $32M · 4-layer verification pipeline · from Cedar · DL-220 · last activity 2h ago
        </div>
      </Card>

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {TRUST_LAYERS.map((l) => (
          <Card key={l.no} className="p-4">
            <div className="flex items-center justify-between">
              <span style={{ color: TONE_HEX[l.tone] }}>
                <ShieldCheck size={15} strokeWidth={1.9} aria-hidden />
              </span>
              <span className="font-mono text-[11px] tabular-nums text-fg-5">{l.no}</span>
            </div>
            <div className="mt-3 text-[13.5px] font-semibold text-fg-1">{l.name}</div>
            <div className="mt-1 text-[11px] leading-snug text-fg-5">{l.desc}</div>
            <div
              className="mt-3 text-[20px] font-semibold tabular-nums"
              style={{ color: TONE_HEX[l.tone] }}
            >
              {l.value}%
            </div>
            <ProgressBar className="mt-2" value={l.value} color={TONE_HEX[l.tone]} height={5} />
          </Card>
        ))}
      </div>

      <div className="grid items-start gap-[18px] lg:grid-cols-2">
        <Card>
          <SectionTitle title="Required documents" className="mb-3" />
          <div className="flex flex-col gap-2">
            {[
              { label: 'Investment thesis memo', done: true },
              { label: 'Market sizing (TAM)', done: true },
              { label: 'Competitive map', done: false }
            ].map((d) => (
              <div key={d.label} className="flex items-center gap-2.5 text-[12.5px]">
                {d.done ? (
                  <CircleCheck size={15} strokeWidth={1.9} className="text-success" aria-hidden />
                ) : (
                  <CircleDot size={15} strokeWidth={1.9} className="text-fg-5" aria-hidden />
                )}
                <span className={d.done ? 'text-fg-1' : 'text-fg-4'}>{d.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle title="Required tasks" className="mb-3" />
          <div className="flex flex-col gap-2">
            {[
              { label: 'Validate thesis vs LP appetite', done: true },
              { label: 'Complete competitive mapping', done: false }
            ].map((d) => (
              <div key={d.label} className="flex items-center gap-2.5 text-[12.5px]">
                {d.done ? (
                  <CircleCheck size={15} strokeWidth={1.9} className="text-success" aria-hidden />
                ) : (
                  <CircleDot size={15} strokeWidth={1.9} className="text-fg-5" aria-hidden />
                )}
                <span className={d.done ? 'text-fg-1' : 'text-fg-4'}>{d.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle
            title="Human approval"
            className="mb-3"
            action={<UserCog size={15} strokeWidth={1.9} className="text-fg-4" aria-hidden />}
          />
          <Badge tone="warning">Pending review</Badge>
          <p className="mt-3 text-[12px] text-fg-4">
            A managing partner must sign off before the chain advances to Proof of execution.
          </p>
          <Button variant="primary" size="sm" className="mt-3" icon={Check}>
            Approve chain
          </Button>
        </Card>

        <Card className="bg-[linear-gradient(100deg,rgba(247,201,72,0.08),transparent_60%)]">
          <SectionTitle
            title="AI validation"
            className="mb-3"
            action={<Sparkles size={15} strokeWidth={1.9} className="text-gold-1" aria-hidden />}
          />
          <p className="text-[12.5px] text-fg-2">
            Thesis aligns with 3 of 4 LP mandates. Competitive map incomplete — add 2 incumbents.
          </p>
        </Card>
      </div>
    </div>
  );
}

function KnowledgePanel() {
  const coo = TEAM_ROSTER.find((m) => m.chief);
  const specialists = TEAM_ROSTER.filter((m) => !m.chief);

  const stats: Stat[] = [
    {
      label: 'The Team',
      value: String(TEAM_ROSTER.length),
      sub: `${coo?.position ?? 'COO'} + ${specialists.length} specialists`,
      icon: BrainCircuit,
      tone: 'gold'
    },
    {
      label: 'Knowledge embeddings',
      value: '15 / 15',
      sub: 'Voyage 1024-dim brains',
      icon: Database,
      tone: 'azure'
    },
    {
      label: 'pgvector store',
      value: 'Live',
      sub: 'match_knowledge_chunks',
      icon: Layers,
      tone: 'success'
    }
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="grid gap-3.5 sm:grid-cols-3">
        {stats.map((s) => (
          <StatTile key={s.label} stat={s} />
        ))}
      </div>

      <Card>
        <SectionTitle
          eyebrow="pgvector knowledge store"
          title={`The Team · ${TEAM_ROSTER.length} members`}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" icon={GitBranch}>
                Routing rules
              </Button>
              <Button variant="primary" size="sm" icon={Upload}>
                Intake knowledge
              </Button>
            </div>
          }
        />
        <div className="grid gap-2.5 lg:grid-cols-2">
          {TEAM_ROSTER.map((m) => (
            <div
              key={m.slug}
              className="flex items-start gap-3 rounded-xl border border-hairline bg-surface-1 p-3"
            >
              <TeamAvatar member={m} size={36} className="flex-none" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-fg-1">{m.name}</span>
                  {m.chief ? (
                    <Badge tone="gold" className="text-[9px]">
                      COO
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-azure-1">
                  {m.position}
                </div>
                <p className="mt-1 text-[11.5px] leading-5 text-fg-3">{m.oneLiner}</p>
              </div>
              <Button variant="secondary" size="sm" icon={Sparkles}>
                Optimize
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle title="Intake → route → optimize" className="mb-3" />
        <div className="flex flex-wrap items-center gap-1.5">
          {PIPELINE_STEPS.map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[11.5px] font-medium text-fg-2">
                {s}
              </span>
              {i < PIPELINE_STEPS.length - 1 && (
                <span className="text-fg-5" aria-hidden>
                  ›
                </span>
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
  const router = useRouter();
  // Member rows share the card lifecycle: approving an applicant "completes"
  // the row (closed); archiving sets the archived flag.
  const cards = useCardState(data.members);

  // Resolve each member's effective status from its shared card flags.
  const statuses: Record<string, MemberStatus> = {};
  for (const m of cards.items) {
    statuses[m.id] = m.archived ? 'Archived' : m.closed ? 'Active' : m.status;
  }

  function setStatus(id: string, status: MemberStatus) {
    if (status === 'Active') {
      cards.complete(id);
      // Approving a member advances the Execution layer of Chain of Trust.
      window.emitTrust?.({
        layer: 'execution',
        title: 'Member approved',
        msg: 'An applicant was approved into the organization.',
        entity: id
      });
      void approveMember(id).then(() => router.refresh());
    } else if (status === 'Archived') {
      cards.archive(id);
      void archiveMember(id).then(() => router.refresh());
    }
  }

  const activeCount = data.members.filter((m) => statuses[m.id] === 'Active').length;
  const pendingCount = data.members.filter((m) => statuses[m.id] === 'Pending').length;

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
      value: String(TEAM_ROSTER.length),
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
        <SectionTitle eyebrow="Platform administration" title="Admin portal" className="mb-0" />
        <Badge tone="gold" dot>
          <span className="inline-flex items-center gap-1.5">
            <Shield size={11} strokeWidth={1.9} aria-hidden />
            Admin access
          </span>
        </Badge>
      </div>

      {(tab === 'users' || tab === 'activity') && (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
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
          { id: 'trust', label: 'Chain of trust', icon: ShieldCheck },
          { id: 'knowledge', label: 'Knowledge base', icon: BrainCircuit }
        ]}
      />

      {tab === 'users' && (
        <UsersPanel members={data.members} statuses={statuses} onSetStatus={setStatus} />
      )}
      {tab === 'activity' && <ActivityPanel actions={data.actions} />}
      {tab === 'trust' && <TrustPanel />}
      {tab === 'knowledge' && <KnowledgePanel />}
    </div>
  );
}
