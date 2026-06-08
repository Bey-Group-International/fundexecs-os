'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCardState } from '@/lib/ui/useCardState';
import { approveMember, archiveMember, setMemberRole } from '@/lib/actions/admin';
import { inviteBetaUser } from '@/lib/actions/beta-invites';
import {
  Users,
  UserPlus,
  Activity,
  Check,
  ChevronDown,
  Archive,
  Shield,
  BrainCircuit,
  Database,
  Layers,
  ShieldCheck,
  Bell,
  CircleDot,
  Mail,
  Inbox,
  Search,
  Copy,
  X,
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
  SegTabs,
  Select,
  type AvatarTone,
  type BadgeTone
} from '@/components/ui';
import { TEAM_ROSTER, TeamAvatar } from '@/lib/team';
import { cn } from '@/lib/utils';
import type { AdminData, AdminMember } from '@/lib/queries/admin';
import type { AdminMetrics, TrustLayerKey } from '@/lib/queries/admin-metrics';
import type { BetaInvite } from '@/lib/queries/beta-invites';
import type { BetaLinkWithStatus } from '@/lib/queries/beta-links';
import type { BetaApplication } from '@/lib/queries/beta-applications';
import { BetaInvitesPanel } from './BetaInvitesPanel';
import { BetaLinksPanel } from './BetaLinksPanel';
import { ApplicationsPanel } from './ApplicationsPanel';

type OrgMemberRole = 'owner' | 'admin' | 'member';
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

/** Role → avatar/accent tone (meaningful, not arbitrary). Gold is Earn's, so
 *  owners read gold-free via the warm-neutral disc; admins azure; members slate. */
const ROLE_TONE: Record<OrgMemberRole, AvatarTone> = {
  owner: 'gold',
  admin: 'azure',
  member: 'azure'
};

/** Token (not hex) accents per tone — drives icon discs + accent rails. */
const TONE_VAR: Record<BadgeTone, string> = {
  neutral: 'var(--fg-4)',
  info: 'var(--info)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  gold: 'var(--gold-1)',
  warning: 'var(--warning)',
  danger: 'var(--danger)'
};

interface Stat {
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
  tone: BadgeTone;
}

/** Chain-of-Trust layers, in order, mapped to the metrics coverage keys. */
const TRUST_LAYERS: Array<{ no: string; key: TrustLayerKey; name: string; desc: string }> = [
  {
    no: '01',
    key: 'truth',
    name: 'Proof of truth',
    desc: 'Source data, citations, verified facts'
  },
  { no: '02', key: 'concept', name: 'Proof of concept', desc: 'Strategy, thesis, fit logic' },
  { no: '03', key: 'execution', name: 'Proof of execution', desc: 'Tasks, workflows, approvals' },
  { no: '04', key: 'work', name: 'Proof of work', desc: 'Evidence, uploads, outcomes, logs' }
];

function coverageTone(pct: number): BadgeTone {
  if (pct >= 75) return 'success';
  if (pct >= 40) return 'gold';
  if (pct > 0) return 'warning';
  return 'neutral';
}

type Tab = 'users' | 'applications' | 'invites' | 'activity' | 'trust' | 'knowledge';

/* ---- Stat tile (bold: tone disc + accent rail) -------------------------- */

function StatTile({ stat }: { stat: Stat }) {
  const Icon = stat.icon;
  const accent = TONE_VAR[stat.tone];
  return (
    <Card className="relative flex-1 overflow-hidden p-4">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: accent }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          {stat.label}
        </span>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg border bg-bg-1"
          style={{ color: accent, borderColor: accent }}
        >
          <Icon size={14} strokeWidth={1.9} aria-hidden />
        </span>
      </div>
      <div className="mt-3 text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
        {stat.value}
      </div>
      <div className="mt-1 text-[11px] text-fg-5">{stat.sub}</div>
    </Card>
  );
}

/** Small "reference / coming soon" pill for not-yet-real metric panels. */
function ReferencePill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-5">
      Reference · soon
    </span>
  );
}

/* ---- Role menu ---------------------------------------------------------- */

function RoleMenu({
  role,
  canGrantOwner,
  isLastOwner,
  pending,
  onChange
}: {
  role: OrgMemberRole;
  canGrantOwner: boolean;
  isLastOwner: boolean;
  pending: boolean;
  onChange: (role: OrgMemberRole) => void;
}) {
  const [open, setOpen] = useState(false);
  const options: OrgMemberRole[] = ['owner', 'admin', 'member'];

  function disabledFor(opt: OrgMemberRole): boolean {
    if (opt === role) return true;
    if (opt === 'owner' && !canGrantOwner) return true;
    // Demoting the last owner is blocked (server enforces too).
    if (role === 'owner' && opt !== 'owner' && isLastOwner) return true;
    return false;
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface-1 px-2 py-1 text-[11.5px] font-medium text-fg-2 transition hover:bg-surface-2 hover:text-fg-1 disabled:opacity-50"
      >
        {ROLE_LABEL[role]}
        <ChevronDown size={12} strokeWidth={2} aria-hidden />
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-1 w-36 overflow-hidden rounded-xl border border-hairline bg-bg-1 shadow-[var(--shadow-md)]"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          >
            {options.map((opt) => {
              const disabled = disabledFor(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  onClick={() => {
                    setOpen(false);
                    onChange(opt);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between px-3 py-2 text-left text-[12px] transition',
                    disabled
                      ? 'cursor-not-allowed text-fg-5'
                      : 'text-fg-2 hover:bg-surface-1 hover:text-fg-1'
                  )}
                >
                  {ROLE_LABEL[opt]}
                  {opt === role ? <Check size={12} strokeWidth={2} aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ---- Invite member panel (reuses the magic-link plumbing) --------------- */

function InviteMemberPanel({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgMemberRole>('member');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !email.trim()) return;
    setPending(true);
    setError(null);
    // Capture the intended role on the invite note until acceptance wires the
    // org_members row at that role (backend task #115).
    const composedNote = [`role: ${role}`, note.trim()].filter(Boolean).join(' · ');
    const res = await inviteBetaUser(email, composedNote);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLink(res.link);
    router.refresh();
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not copy — select and copy the link manually.');
    }
  }

  return (
    <Card className="border-[var(--azure-line)] bg-[var(--azure-soft)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[12.5px] font-semibold text-fg-1">Invite a member</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close invite"
          className="flex h-6 w-6 items-center justify-center rounded-md text-fg-4 transition hover:bg-surface-1 hover:text-fg-1"
        >
          <X size={14} strokeWidth={1.9} aria-hidden />
        </button>
      </div>

      {link ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-fg-2">
            Magic link minted for <span className="font-semibold">{email}</span>. Share it — the
            member joins as <span className="font-semibold">{ROLE_LABEL[role]}</span> on acceptance.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={link}
              className="min-w-0 flex-1 truncate rounded-lg border border-hairline bg-bg-1 px-2.5 py-1.5 font-mono text-[11px] text-fg-3"
            />
            <Button variant="secondary" size="sm" icon={Copy} onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2.5">
          <div className="grid gap-2.5 sm:grid-cols-[1.6fr_1fr]">
            <Input
              type="email"
              required
              icon={Mail}
              placeholder="name@firm.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Invite email"
            />
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as OrgMemberRole)}
              aria-label="Invite role"
              options={[
                { value: 'member', label: 'Member' },
                { value: 'admin', label: 'Admin' },
                { value: 'owner', label: 'Owner' }
              ]}
            />
          </div>
          <Input
            placeholder="Optional note (e.g. how you know them)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Invite note"
          />
          {error ? <p className="text-[12px] text-danger">{error}</p> : null}
          <div className="flex justify-end">
            <Button variant="primary" size="sm" type="submit" disabled={pending || !email.trim()}>
              {pending ? 'Minting link…' : 'Send invite'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/* ---- Users panel -------------------------------------------------------- */

function UsersPanel({
  members,
  statuses,
  roles,
  ownerCount,
  viewerRole,
  rowErrors,
  pendingId,
  onApprove,
  onArchive,
  onRole
}: {
  members: AdminMember[];
  statuses: Record<string, MemberStatus>;
  roles: Record<string, OrgMemberRole>;
  ownerCount: number;
  viewerRole: OrgMemberRole | null;
  rowErrors: Record<string, string>;
  pendingId: string | null;
  onApprove: (id: string) => void;
  onArchive: (id: string) => void;
  onRole: (id: string, role: OrgMemberRole) => void;
}) {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | OrgMemberRole>('all');
  const [inviteOpen, setInviteOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = members.filter((m) => {
    const role = roles[m.id] ?? m.role;
    if (roleFilter !== 'all' && role !== roleFilter) return false;
    if (q && !m.name.toLowerCase().includes(q)) return false;
    return true;
  });

  const roleChips: Array<{ id: 'all' | OrgMemberRole; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'owner', label: 'Owners' },
    { id: 'admin', label: 'Admins' },
    { id: 'member', label: 'Members' }
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {roleChips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setRoleFilter(c.id)}
              aria-pressed={roleFilter === c.id}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition',
                roleFilter === c.id
                  ? 'border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1'
                  : 'border-hairline bg-surface-1 text-fg-3 hover:text-fg-1'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="w-full sm:w-56">
            <Input
              icon={Search}
              placeholder="Search members…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search members"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={UserPlus}
            onClick={() => setInviteOpen((v) => !v)}
          >
            Invite
          </Button>
        </div>
      </div>

      {inviteOpen ? <InviteMemberPanel onClose={() => setInviteOpen(false)} /> : null}

      {filtered.length === 0 ? (
        <Card className="p-10 text-center text-[13px] text-fg-5">
          {members.length === 0 ? 'No members in this organization.' : 'No members match.'}
        </Card>
      ) : (
        <Card className="p-2">
          <div className="grid grid-cols-[1.8fr_1.1fr_0.9fr_1fr] gap-2 px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            <span>Member</span>
            <span>Role</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          <div className="h-px bg-hairline" />
          {filtered.map((m) => {
            const role = roles[m.id] ?? m.role;
            const status = statuses[m.id] ?? m.status;
            const tone: AvatarTone = ROLE_TONE[role] ?? 'azure';
            const isLastOwner = role === 'owner' && ownerCount <= 1;
            const err = rowErrors[m.id];
            return (
              <div
                key={m.id}
                className="grid grid-cols-[1.8fr_1.1fr_0.9fr_1fr] items-center gap-2 border-b border-hairline-faint px-3 py-2.5 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={m.name} size={30} tone={tone} />
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-semibold text-fg-1">{m.name}</div>
                    {err ? <div className="truncate text-[10.5px] text-danger">{err}</div> : null}
                  </div>
                </div>
                <div>
                  <RoleMenu
                    role={role}
                    canGrantOwner={viewerRole === 'owner'}
                    isLastOwner={isLastOwner}
                    pending={pendingId === m.id}
                    onChange={(next) => onRole(m.id, next)}
                  />
                </div>
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
                      onClick={() => onApprove(m.id)}
                      className="flex h-[27px] w-[27px] items-center justify-center rounded-md border border-[var(--success-line)] bg-[var(--success-soft)] text-success transition hover:brightness-110"
                    >
                      <Check size={13} strokeWidth={1.9} aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    title={isLastOwner ? 'The last owner cannot be archived' : 'Archive'}
                    aria-label="Archive"
                    disabled={isLastOwner || status === 'Archived'}
                    onClick={() => onArchive(m.id)}
                    className="flex h-[27px] w-[27px] items-center justify-center rounded-md border border-hairline bg-surface-1 text-fg-4 transition hover:bg-surface-2 hover:text-fg-1 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Archive size={13} strokeWidth={1.9} aria-hidden />
                  </button>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

/* ---- Activity panel (real notifications) -------------------------------- */

interface NoteItem {
  title: string;
  detail: string;
  tone: BadgeTone;
}

function ActivityPanel({
  actions,
  notifications
}: {
  actions: AdminData['actions'];
  notifications: NoteItem[];
}) {
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
        {notifications.length === 0 ? (
          <div className="rounded-xl border border-dashed border-hairline bg-surface-1 p-4 text-center text-[12px] text-fg-4">
            All clear — nothing needs your attention.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {notifications.map((n) => (
              <div
                key={n.title}
                className="flex items-start gap-2.5 rounded-xl border border-hairline bg-surface-1 p-3"
              >
                <span className="mt-0.5 flex-none" style={{ color: TONE_VAR[n.tone] }}>
                  <CircleDot size={13} strokeWidth={1.9} aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-fg-1">{n.title}</div>
                  <div className="text-[11px] text-fg-4">{n.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---- Trust panel (metrics-driven) --------------------------------------- */

function TrustPanel({ metrics }: { metrics: AdminMetrics | null }) {
  const placeholder = metrics?.placeholder ?? true;
  const coverage = metrics?.trust.layerCoverage;
  return (
    <div className="flex flex-col gap-[18px]">
      <Card className="bg-[linear-gradient(100deg,var(--success-soft),transparent_60%)]">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-hairline bg-surface-2 text-success">
            <ShieldCheck size={18} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Chain of Trust
            </div>
            <div className="text-[15px] font-semibold tracking-[-0.01em] text-fg-1">
              Real chains live on each deal
            </div>
            <p className="mt-1 max-w-prose text-[12.5px] leading-relaxed text-fg-3">
              Open Command Center or Pipeline and click the Trust chip on any deal to start or
              inspect a four-layer Chain of Trust (Proof of Truth, Concept, Execution, Work) with
              evidence uploads, AI validation, and human approvals.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="/command-center"
                className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-1 px-3 py-1.5 text-[11.5px] font-medium text-fg-2 transition hover:border-[var(--azure-line)] hover:text-fg-1"
              >
                Open Command Center
              </a>
              <a
                href="/pipeline"
                className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-1 px-3 py-1.5 text-[11.5px] font-medium text-fg-2 transition hover:border-[var(--azure-line)] hover:text-fg-1"
              >
                View Pipeline
              </a>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <SectionTitle eyebrow="Org-wide" title="Layer coverage" className="mb-0" />
        {placeholder ? <ReferencePill /> : null}
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {TRUST_LAYERS.map((l) => {
          const pct = coverage?.[l.key] ?? 0;
          const tone = coverageTone(pct);
          return (
            <Card key={l.no} className="relative overflow-hidden p-4">
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-1"
                style={{ backgroundColor: TONE_VAR[tone] }}
              />
              <div className="flex items-center justify-between">
                <span style={{ color: TONE_VAR[tone] }}>
                  <ShieldCheck size={15} strokeWidth={1.9} aria-hidden />
                </span>
                <span className="font-mono text-[11px] tabular-nums text-fg-5">{l.no}</span>
              </div>
              <div className="mt-3 text-[13.5px] font-semibold text-fg-1">{l.name}</div>
              <div className="mt-1 text-[11px] leading-snug text-fg-5">{l.desc}</div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-fg-4">
                <span>{placeholder ? 'Coming soon' : 'Coverage'}</span>
                <span className="tabular-nums" style={{ color: TONE_VAR[tone] }}>
                  {placeholder ? '—' : `${pct}%`}
                </span>
              </div>
              <div className="mt-1.5">
                <ProgressBar value={placeholder ? 0 : pct} height={6} />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Knowledge panel (metrics-driven) ----------------------------------- */

function KnowledgePanel({ metrics }: { metrics: AdminMetrics | null }) {
  const placeholder = metrics?.placeholder ?? true;
  const coo = TEAM_ROSTER.find((m) => m.chief);
  const specialists = TEAM_ROSTER.filter((m) => !m.chief);
  const brainsTotal = metrics?.brains.total || TEAM_ROSTER.length;

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
      value: placeholder ? '—' : `${metrics?.brains.embedded ?? 0} / ${brainsTotal}`,
      sub: placeholder ? 'Coverage coming soon' : 'Voyage 1024-dim brains',
      icon: Database,
      tone: 'azure'
    },
    {
      label: 'pgvector store',
      value: placeholder ? '—' : metrics?.vector.status === 'live' ? 'Live' : 'Degraded',
      sub: placeholder
        ? 'Status coming soon'
        : `${(metrics?.vector.chunks ?? 0).toLocaleString()} chunks`,
      icon: Layers,
      tone: placeholder ? 'neutral' : metrics?.vector.status === 'live' ? 'success' : 'warning'
    }
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-center justify-between">
        <SectionTitle
          eyebrow="pgvector knowledge store"
          title="Platform metrics"
          className="mb-0"
        />
        {placeholder ? <ReferencePill /> : null}
      </div>
      <div className="grid gap-3.5 sm:grid-cols-3">
        {stats.map((s) => (
          <StatTile key={s.label} stat={s} />
        ))}
      </div>

      <Card>
        <SectionTitle eyebrow="The Team" title={`${TEAM_ROSTER.length} members`} className="mb-3" />
        <div className="grid gap-2.5 lg:grid-cols-2">
          {TEAM_ROSTER.map((m) => (
            <div
              key={m.slug}
              className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 p-3"
            >
              <TeamAvatar member={m} size={36} className="flex-none" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-fg-1">{m.name}</div>
                <div className="truncate text-[11px] text-fg-4">{m.position}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ---- Main view ---------------------------------------------------------- */

export function AdminView({
  data,
  invites,
  betaLinks,
  applications,
  metrics,
  viewerRole
}: {
  data: AdminData;
  invites: BetaInvite[];
  betaLinks: BetaLinkWithStatus[];
  applications: BetaApplication[];
  metrics: AdminMetrics | null;
  viewerRole: OrgMemberRole | null;
}) {
  const [tab, setTab] = useState<Tab>('users');
  const router = useRouter();
  // Member rows share the card lifecycle: approving an applicant "completes"
  // the row (closed); archiving sets the archived flag.
  const cards = useCardState(data.members);

  // Optimistic role overrides + per-row error/pending state for role changes.
  const [roleOverrides, setRoleOverrides] = useState<Record<string, OrgMemberRole>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const statuses: Record<string, MemberStatus> = {};
  for (const m of cards.items) {
    statuses[m.id] = m.archived ? 'Archived' : m.closed ? 'Active' : m.status;
  }
  const roles: Record<string, OrgMemberRole> = {};
  for (const m of data.members) {
    roles[m.id] = roleOverrides[m.id] ?? (m.role as OrgMemberRole);
  }
  const ownerCount = data.members.filter((m) => roles[m.id] === 'owner').length;

  function approve(id: string) {
    cards.complete(id);
    window.emitTrust?.({
      layer: 'execution',
      title: 'Member approved',
      msg: 'An applicant was approved into the organization.',
      entity: id
    });
    void approveMember(id).then(() => router.refresh());
  }

  function archive(id: string) {
    cards.archive(id);
    void archiveMember(id).then((res) => {
      if (!res.ok) setRowErrors((e) => ({ ...e, [id]: res.error }));
      router.refresh();
    });
  }

  function changeRole(id: string, role: OrgMemberRole) {
    const prev = roles[id];
    setPendingId(id);
    setRowErrors((e) => ({ ...e, [id]: '' }));
    setRoleOverrides((r) => ({ ...r, [id]: role })); // optimistic
    void setMemberRole(id, role).then((res) => {
      setPendingId(null);
      if (!res.ok) {
        setRoleOverrides((r) => ({ ...r, [id]: prev })); // revert
        setRowErrors((e) => ({ ...e, [id]: res.error }));
        return;
      }
      router.refresh();
    });
  }

  const openInvites = invites.filter((i) => i.status === 'pending');
  const pendingApplications = applications.filter((a) => a.review === 'pending').length;

  const adminStats: Stat[] = [
    {
      label: 'Members',
      value: String(data.members.length),
      sub: `${ownerCount} owner${ownerCount === 1 ? '' : 's'}`,
      icon: Users,
      tone: 'azure'
    },
    {
      label: 'Open invites',
      value: String(openInvites.length),
      sub: openInvites.length ? 'Awaiting acceptance' : 'All accepted',
      icon: Mail,
      tone: openInvites.length ? 'warning' : 'success'
    },
    {
      label: 'AI brains',
      value: String(metrics?.brains.total || TEAM_ROSTER.length),
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

  // Real notifications, derived from live signals (no fabricated data).
  const notifications: NoteItem[] = [];
  if (openInvites.length > 0) {
    notifications.push({
      title: `${openInvites.length} invite${openInvites.length === 1 ? '' : 's'} awaiting acceptance`,
      detail: openInvites
        .slice(0, 3)
        .map((i) => i.email)
        .join(', '),
      tone: 'warning'
    });
  }
  const lastAction = data.actions[0];
  if (lastAction) {
    notifications.push({
      title: 'Latest admin action',
      detail: `${lastAction.actionType} · ${lastAction.actor} · ${lastAction.time}`,
      tone: 'azure'
    });
  }

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
          {
            id: 'applications',
            label: 'Applications',
            icon: Inbox,
            // Surface the count of applications awaiting review across tabs, so an
            // admin on another tab still sees there's a queue. Hidden at zero.
            count: pendingApplications || undefined
          },
          { id: 'invites', label: 'Beta invites', icon: Mail },
          { id: 'activity', label: 'Activity', icon: Activity },
          { id: 'trust', label: 'Chain of trust', icon: ShieldCheck },
          { id: 'knowledge', label: 'Knowledge base', icon: BrainCircuit }
        ]}
      />

      {tab === 'users' && (
        <UsersPanel
          members={data.members}
          statuses={statuses}
          roles={roles}
          ownerCount={ownerCount}
          viewerRole={viewerRole}
          rowErrors={rowErrors}
          pendingId={pendingId}
          onApprove={approve}
          onArchive={archive}
          onRole={changeRole}
        />
      )}
      {tab === 'applications' && <ApplicationsPanel applications={applications} />}
      {tab === 'invites' && (
        <div className="flex flex-col gap-[18px]">
          <BetaInvitesPanel invites={invites} />
          <BetaLinksPanel links={betaLinks} />
        </div>
      )}
      {tab === 'activity' && <ActivityPanel actions={data.actions} notifications={notifications} />}
      {tab === 'trust' && <TrustPanel metrics={metrics} />}
      {tab === 'knowledge' && <KnowledgePanel metrics={metrics} />}
    </div>
  );
}
