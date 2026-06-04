'use client';

import { useState } from 'react';
import {
  Zap,
  Eye,
  Link2,
  ShieldCheck,
  Target,
  Sparkles,
  Shield,
  Briefcase,
  Check,
  CheckCheck,
  Archive,
  Trash2,
  X,
  ArrowRight,
  type LucideIcon
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Badge, Button, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/utils';

/* ---- Mock data — shaped to mirror the `notifications` table ---- */

interface Notification {
  id: string;
  category: string;
  icon: LucideIcon;
  tone: BadgeTone;
  title: string;
  body: string;
  meta: string;
  time: string;
  read: boolean;
}

const SEED: Notification[] = [
  {
    id: 'syn-3318',
    category: 'Synergy',
    icon: Zap,
    tone: 'gold',
    title: 'Synergy opportunity detected',
    body: 'Meridian Family Office matched to your Series A allocation — strategic fit 92%.',
    meta: 'SYN-3318 · routed → Capital Connector',
    time: '4m',
    read: false
  },
  {
    id: 'lp-051',
    category: 'LP interest',
    icon: Eye,
    tone: 'azure',
    title: 'Granite Endowment opened your deck twice',
    body: 'Earn drafted a follow-up message. Suggested call slot: Thursday 2pm.',
    meta: 'LP-051 · pipeline → Soft circle',
    time: '1h',
    read: false
  },
  {
    id: 'cp-09',
    category: 'Capital match',
    icon: Link2,
    tone: 'info',
    title: 'Capital provider match',
    body: 'Sterling Private Credit can fund Cedar roll-up via unitranche (~11.5%).',
    meta: 'CP-09 · capital stack',
    time: '3h',
    read: false
  },
  {
    id: 'cot-0187',
    category: 'Chain of Trust',
    icon: ShieldCheck,
    tone: 'success',
    title: 'Proof of truth approved',
    body: 'Atlas Manufacturing cleared layer 1. Concept layer now unlocked.',
    meta: 'COT-0187 · J. Avery',
    time: '5h',
    read: true
  },
  {
    id: 'gov-001',
    category: 'Strategy',
    icon: Target,
    tone: 'warning',
    title: 'Strategy reminder',
    body: '100-day objective “Close anchor LP” is at 40% with 9 days to deadline.',
    meta: 'GOV-001 · High priority',
    time: '8h',
    read: true
  },
  {
    id: 'task-204',
    category: 'Copilot',
    icon: Sparkles,
    tone: 'azure',
    title: 'Earn completed: monthly LP update',
    body: 'Draft ready for review — Q2 pipeline summary + commitment progress.',
    meta: 'TASK-204',
    time: '1d',
    read: true
  },
  {
    id: 'cot-0220',
    category: 'Admin',
    icon: Shield,
    tone: 'danger',
    title: 'Admin alert: critical-risk item',
    body: 'Cedar earn-out terms flagged critical. Routed to Legal / Admin before execution.',
    meta: 'COT-0220 · escalated',
    time: '1d',
    read: true
  },
  {
    id: 'pt-18',
    category: 'Service',
    icon: Briefcase,
    tone: 'neutral',
    title: 'Service provider recommendation',
    body: 'Orion CPA Group recommended for Fund II quarterly accounting.',
    meta: 'PT-18',
    time: '2d',
    read: true
  }
];

const CATEGORIES = [
  'All',
  'Synergy',
  'LP interest',
  'Chain of Trust',
  'Strategy',
  'Copilot',
  'Admin'
];

type Action = 'read' | 'archive' | 'delete';

const ROW_ACTIONS: Array<{ act: Action; icon: LucideIcon; label: string }> = [
  { act: 'read', icon: Check, label: 'Mark read' },
  { act: 'archive', icon: Archive, label: 'Archive' },
  { act: 'delete', icon: Trash2, label: 'Delete' }
];

function NotifRow({
  n,
  onAct,
  onOpen
}: {
  n: Notification;
  onAct: (id: string, a: Action) => void;
  onOpen: (n: Notification) => void;
}) {
  const Icon = n.icon;
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className={cn(
        'group flex w-full items-start gap-3 rounded-xl border border-transparent p-3.5 text-left transition',
        n.read ? 'hover:bg-surface-1' : 'border-hairline bg-surface-1'
      )}
    >
      <span
        className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border"
        style={{
          color: `var(--${n.tone}-1, var(--fg-3))`,
          background: `var(--${n.tone}-soft, var(--surface-2))`,
          borderColor: `var(--${n.tone}-line, var(--border))`
        }}
      >
        <Icon size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {!n.read && (
            <span
              className="h-1.5 w-1.5 flex-none rounded-full"
              style={{ background: `var(--${n.tone}-1, var(--fg-3))` }}
              aria-hidden
            />
          )}
          <span className="text-[13.5px] font-semibold text-fg-1">{n.title}</span>
        </div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-fg-3">{n.body}</div>
        <div className="mt-1.5 font-mono text-[10.5px] text-fg-5">{n.meta}</div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <span className="font-mono text-[10.5px] text-fg-5">{n.time}</span>
        <span
          className="flex gap-1 opacity-0 transition group-hover:opacity-100"
          // Prevent row-open when clicking an action button.
          onClick={(e) => e.stopPropagation()}
        >
          {ROW_ACTIONS.map(({ act, icon: ActIcon, label }) => (
            <span
              key={act}
              role="button"
              tabIndex={0}
              title={label}
              aria-label={label}
              onClick={() => onAct(n.id, act)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onAct(n.id, act);
              }}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-hairline bg-surface-1 text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
            >
              <ActIcon size={12} strokeWidth={1.9} aria-hidden />
            </span>
          ))}
        </span>
      </div>
    </button>
  );
}

function NotifDetail({
  n,
  onClose,
  onAct
}: {
  n: Notification;
  onClose: () => void;
  onAct: (id: string, a: Action) => void;
}) {
  const Icon = n.icon;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <Card className="relative z-10 w-[460px] max-w-[92vw] p-6">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] border"
            style={{
              color: `var(--${n.tone}-1, var(--fg-3))`,
              background: `var(--${n.tone}-soft, var(--surface-2))`,
              borderColor: `var(--${n.tone}-line, var(--border))`
            }}
          >
            <Icon size={19} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <Badge tone={n.tone} className="text-[10px]">
              {n.category}
            </Badge>
            <div className="mt-1.5 text-[16px] font-semibold tracking-[-0.015em] text-fg-1">
              {n.title}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-none text-fg-4 transition hover:text-fg-1"
          >
            <X size={18} strokeWidth={1.9} aria-hidden />
          </button>
        </div>
        <p className="mt-4 text-[13.5px] leading-relaxed text-fg-2">{n.body}</p>
        <div className="mt-2.5 font-mono text-[11px] text-fg-5">
          {n.meta} · {n.time} ago
        </div>
        <div className="mt-5 flex gap-2.5">
          <Button variant="primary" iconRight={ArrowRight} className="flex-1">
            Take action
          </Button>
          <Button
            variant="secondary"
            icon={Archive}
            onClick={() => {
              onAct(n.id, 'archive');
              onClose();
            }}
          >
            Archive
          </Button>
          <Button
            variant="ghost"
            icon={Trash2}
            aria-label="Delete"
            onClick={() => {
              onAct(n.id, 'delete');
              onClose();
            }}
          />
        </div>
      </Card>
    </div>
  );
}

export default function NotificationsPage() {
  const [notifs, setNotifs] = useState<Notification[]>(SEED);
  const [category, setCategory] = useState('All');
  const [open, setOpen] = useState<Notification | null>(null);

  function act(id: string, a: Action) {
    setNotifs((prev) =>
      prev.flatMap((n) => {
        if (n.id !== id) return [n];
        if (a === 'delete' || a === 'archive') return [];
        if (a === 'read') return [{ ...n, read: true }];
        return [n];
      })
    );
  }

  function markAllRead() {
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  const visible = notifs.filter((n) => category === 'All' || n.category === category);
  const unread = notifs.filter((n) => !n.read).length;

  return (
    <AppShell title="Notifications" subtitle="Your private-market inbox">
      <div className="flex flex-col gap-[18px]">
        <div className="flex items-end justify-between">
          <SectionTitle eyebrow={`${unread} unread`} title="Notification center" className="mb-0" />
          <Button variant="secondary" icon={CheckCheck} size="sm" onClick={markAllRead}>
            Mark all read
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const on = category === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  'rounded-full border border-hairline px-3 py-1.5 text-xs font-medium transition',
                  on ? 'bg-surface-3 text-fg-1' : 'bg-surface-1 text-fg-4 hover:text-fg-2'
                )}
              >
                {c}
              </button>
            );
          })}
        </div>

        <Card className="p-2">
          {visible.length ? (
            visible.map((n, i) => (
              <div key={n.id}>
                <NotifRow n={n} onAct={act} onOpen={setOpen} />
                {i < visible.length - 1 && <div className="mx-3.5 h-px bg-hairline-faint" />}
              </div>
            ))
          ) : (
            <div className="p-10 text-center text-[13px] text-fg-5">
              Nothing here. You’re all caught up.
            </div>
          )}
        </Card>
      </div>

      {open && <NotifDetail n={open} onClose={() => setOpen(null)} onAct={act} />}
    </AppShell>
  );
}
