'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCardState } from '@/lib/ui/useCardState';
import { awardTrustXp } from '@/lib/actions/xp';
import {
  Plus,
  Filter,
  Sparkles,
  Circle,
  CheckCircle2,
  Check,
  Archive,
  Trash2,
  Calendar,
  ListChecks,
  ArrowUpRight,
  FileText,
  Users,
  Search,
  type LucideIcon
} from 'lucide-react';
import { Badge, Button, Card, SectionTitle, SegTabs, type BadgeTone } from '@/components/ui';
import { TeamAvatar, getCOO, getSpecialists, TEAM_ROSTER } from '@/lib/team';
import { cn } from '@/lib/utils';
import type { EarnTask } from '@/lib/queries/ask-earn';
import { EarnChat } from './EarnChat';

type Priority = EarnTask['priority'];
type FilterTab = 'open' | 'done' | 'archived';
type Action = 'done' | 'read' | 'archive' | 'delete';

const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  Critical: 'danger',
  High: 'warning',
  Medium: 'azure',
  Low: 'neutral'
};

const ROW_ACTIONS: Array<{ act: Action; icon: LucideIcon; label: string }> = [
  { act: 'read', icon: Check, label: 'Mark read' },
  { act: 'archive', icon: Archive, label: 'Archive' },
  { act: 'delete', icon: Trash2, label: 'Delete' }
];

const NEXT_STEPS: Array<{ label: string; icon: LucideIcon }> = [
  { label: 'Build LP list', icon: Users },
  { label: 'Review deck like an institutional LP', icon: FileText },
  { label: 'Generate investor outreach', icon: FileText },
  { label: 'Summarize last meeting', icon: Search },
  { label: 'Create diligence checklist', icon: ListChecks }
];

function TaskRow({ t, onAct }: { t: EarnTask; onAct: (id: string, a: Action) => void }) {
  const done = t.state === 'done';
  return (
    <Card
      className={cn(
        'group p-3.5',
        !t.read && 'border-[var(--azure-line)] bg-[rgba(91,141,239,0.05)]',
        done && 'opacity-60'
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onAct(t.id, 'done')}
          title="Mark complete"
          aria-label="Mark complete"
          className={cn(
            'mt-px flex-none transition',
            done ? 'text-success' : 'text-fg-5 hover:text-fg-2'
          )}
        >
          {done ? (
            <CheckCircle2 size={18} strokeWidth={1.9} aria-hidden />
          ) : (
            <Circle size={18} strokeWidth={1.9} aria-hidden />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {!t.read && <span className="h-1.5 w-1.5 rounded-full bg-azure-1" aria-hidden />}
            <span className={cn('text-[13.5px] font-semibold text-fg-1', done && 'line-through')}>
              {t.title}
            </span>
            <Badge tone={PRIORITY_TONE[t.priority]} className="text-[9.5px]">
              {t.priority}
            </Badge>
          </div>
          {t.desc && <div className="mt-1 text-[12.5px] text-fg-3">{t.desc}</div>}
        </div>

        <div className="flex gap-1 opacity-30 transition group-hover:opacity-100">
          {ROW_ACTIONS.map(({ act, icon: Icon, label }) => (
            <button
              key={act}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => onAct(t.id, act)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline bg-surface-1 text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
            >
              <Icon size={13} strokeWidth={1.9} aria-hidden />
            </button>
          ))}
        </div>
      </div>

      {/* Earn note — Earn's suggested next move for this task (gold). */}
      <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3 py-2">
        <Sparkles size={13} strokeWidth={1.9} className="mt-px flex-none text-gold-1" aria-hidden />
        <span className="text-[12px] text-fg-2">
          <span className="font-semibold text-gold-1">Earn:</span> {t.earnNote}
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-4 text-[11px] text-fg-5">
        <span className="flex items-center gap-1.5">
          <Sparkles size={12} strokeWidth={1.9} aria-hidden />
          {t.source}
        </span>
        <span className="flex items-center gap-1.5">
          <Calendar size={12} strokeWidth={1.9} aria-hidden />
          {t.due}
        </span>
      </div>
    </Card>
  );
}

function TeamRoster() {
  const coo = getCOO();
  const specialists = getSpecialists();
  return (
    <Card>
      <SectionTitle eyebrow={`${TEAM_ROSTER.length} members`} title="The Team" className="mb-3" />
      <ul className="flex flex-col gap-1.5">
        {/* Earn (COO) — anchored at the top, gold pill. */}
        <li className="flex items-start gap-2.5 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2.5 py-2">
          <TeamAvatar member={coo} size={32} online className="flex-none" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[12.5px] font-semibold text-fg-1">{coo.name}</span>
              <Badge tone="gold" className="text-[9px]">
                COO
              </Badge>
            </div>
            <div className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-gold-1">
              {coo.position}
            </div>
            <p className="mt-0.5 text-[11.5px] leading-5 text-fg-3">{coo.oneLiner}</p>
          </div>
        </li>

        {specialists.map((m) => (
          <li
            key={m.slug}
            className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 transition hover:bg-surface-1"
          >
            <TeamAvatar member={m} size={28} className="mt-0.5 flex-none" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-fg-1">{m.name}</div>
              <div className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-azure-1">
                {m.position}
              </div>
              <p className="mt-0.5 text-[11.5px] leading-5 text-fg-3">{m.oneLiner}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function AskEarnView({ initialTasks }: { initialTasks: EarnTask[] }) {
  const cards = useCardState(initialTasks, (t) => ({
    read: t.read,
    archived: t.state === 'archived',
    closed: t.state === 'done'
  }));
  const [filter, setFilter] = useState<FilterTab>('open');
  const router = useRouter();
  const earn = getCOO();
  const teamSize = TEAM_ROSTER.length;

  function act(id: string, a: Action) {
    if (a === 'delete') {
      cards.delete(id);
      return;
    }
    if (a === 'archive') {
      cards.archive(id);
      return;
    }
    if (a === 'read') {
      cards.markRead(id);
      return;
    }
    // 'done' toggles completion: completing fires a Chain-of-Trust toast.
    const current = cards.items.find((t) => t.id === id);
    if (current?.closed) {
      cards.restore(id);
      cards.markRead(id);
    } else {
      cards.complete(id);
      window.emitTrust?.({
        layer: 'execution',
        title: 'Task complete',
        msg: 'A task was completed in Ask Earn.',
        entity: id
      });
      void awardTrustXp({ layer: 'execution', entityType: 'task', entityId: id }).then(() =>
        router.refresh()
      );
    }
  }

  // Project the shared card flags back onto each task's board state.
  const tasks = cards.items
    .filter((t) => !t.deleted)
    .map((t) => ({
      ...t,
      state: t.archived ? ('archived' as const) : t.closed ? ('done' as const) : ('open' as const)
    }));

  const counts = {
    open: tasks.filter((t) => t.state === 'open').length,
    done: tasks.filter((t) => t.state === 'done').length,
    archived: tasks.filter((t) => t.state === 'archived').length
  };
  const shown = tasks.filter((t) => t.state === filter);
  const workflowCount = tasks.length;

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-end justify-between gap-3">
        <SectionTitle
          eyebrow={`${earn.name} · ${earn.position}`}
          title="Ask Earn"
          className="mb-0"
        />
        <div className="flex items-center gap-2.5">
          <Button variant="secondary" icon={Filter} size="sm">
            Filter
          </Button>
          <Button variant="primary" icon={Plus}>
            New task
          </Button>
        </div>
      </div>

      {/* Earn presence band + live command bar (the live EarnChat copilot). */}
      <Card className="bg-[linear-gradient(100deg,rgba(247,201,72,0.09),transparent_60%)] px-[18px] py-3.5">
        <div className="flex items-center gap-4">
          <TeamAvatar member={earn} size={44} glow online />
          <div className="min-w-0 flex-1 text-[13px] text-fg-2">
            <span className="font-semibold text-fg-1">{earn.name}</span>, your {earn.position}, is
            running <span className="font-semibold text-gold-1">{workflowCount} workflows</span>{' '}
            across a team of <span className="font-semibold text-gold-1">{teamSize}</span> —{' '}
            <span className="font-semibold text-gold-1">{counts.open}</span> awaiting you.
          </div>
        </div>
        {/* Live Earn copilot chat (posts to /api/ask-earn). */}
        <div className="mt-3">
          <EarnChat />
        </div>
      </Card>

      <div className="grid items-start gap-[18px] lg:grid-cols-[1fr_320px]">
        <div>
          <SegTabs
            className="mb-3.5"
            active={filter}
            onChange={(id) => setFilter(id as FilterTab)}
            tabs={[
              { id: 'open', label: 'Open', count: counts.open },
              { id: 'done', label: 'Completed', count: counts.done },
              { id: 'archived', label: 'Archived', count: counts.archived }
            ]}
          />
          <div className="flex flex-col gap-2.5">
            {shown.length ? (
              shown.map((t) => <TaskRow key={t.id} t={t} onAct={act} />)
            ) : (
              <Card className="p-10 text-center text-[13px] text-fg-5">No {filter} tasks.</Card>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-[18px]">
          <Card>
            <SectionTitle eyebrow="Recommended" title="Next steps" className="mb-3" />
            <div className="flex flex-col gap-0.5">
              {NEXT_STEPS.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.label}
                    type="button"
                    className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-2 text-left transition hover:bg-surface-1"
                  >
                    <Icon size={14} strokeWidth={1.9} className="text-fg-4" aria-hidden />
                    <span className="flex-1 text-[12.5px] text-fg-2">{s.label}</span>
                    <ArrowUpRight size={13} strokeWidth={1.9} className="text-fg-5" aria-hidden />
                  </button>
                );
              })}
            </div>
          </Card>

          <TeamRoster />
        </div>
      </div>
    </div>
  );
}
