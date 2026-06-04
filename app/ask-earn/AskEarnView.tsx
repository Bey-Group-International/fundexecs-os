'use client';

import { useState } from 'react';
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
  Layers,
  type LucideIcon
} from 'lucide-react';
import { Badge, Button, Card, SectionTitle, SegTabs, type BadgeTone } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { BRAINS } from '@/components/screens/brains';
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
  { label: 'Build a targeted LP list', icon: Users },
  { label: 'Review my deck like an LP', icon: FileText },
  { label: 'Draft a monthly LP update', icon: FileText },
  { label: 'Find capital for Cedar roll-up', icon: Search },
  { label: 'Summarize new diligence docs', icon: Layers }
];

function TaskRow({ t, onAct }: { t: EarnTask; onAct: (id: string, a: Action) => void }) {
  const done = t.state === 'done';
  return (
    <Card
      className={cn(
        'group flex items-start gap-3 p-3.5',
        !t.read && 'border-[var(--azure-line)] bg-[rgba(91,141,239,0.05)]',
        done && 'opacity-60'
      )}
    >
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
    </Card>
  );
}

export function AskEarnView({ initialTasks }: { initialTasks: EarnTask[] }) {
  const [tasks, setTasks] = useState<EarnTask[]>(initialTasks);
  const [filter, setFilter] = useState<FilterTab>('open');

  function act(id: string, a: Action) {
    setTasks((prev) =>
      prev.flatMap((t) => {
        if (t.id !== id) return [t];
        if (a === 'delete') return [];
        if (a === 'done')
          return [{ ...t, state: t.state === 'done' ? 'open' : 'done', read: true }];
        if (a === 'read') return [{ ...t, read: true }];
        if (a === 'archive') return [{ ...t, state: 'archived', read: true }];
        return [t];
      })
    );
  }

  const counts = {
    open: tasks.filter((t) => t.state === 'open').length,
    done: tasks.filter((t) => t.state === 'done').length,
    archived: tasks.filter((t) => t.state === 'archived').length
  };
  const shown = tasks.filter((t) => t.state === filter);

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-end justify-between gap-3">
        <SectionTitle eyebrow="Copilot task manager" title="Ask Earn" className="mb-0" />
        <div className="flex items-center gap-2.5">
          <Button variant="secondary" icon={Filter} size="sm">
            Filter
          </Button>
          <Button variant="primary" icon={Plus}>
            New task
          </Button>
        </div>
      </div>

      {/* Earn presence band + command bar (presentational chat surface) */}
      <Card className="flex items-center gap-4 bg-[linear-gradient(100deg,rgba(247,201,72,0.09),transparent_60%)] px-[18px] py-3.5">
        <EarnCoin size={40} glow online />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-fg-2">
            <span className="font-semibold text-fg-1">Earnest Fundmaker</span>, your private-market
            assistant, is tracking{' '}
            <span className="font-semibold text-gold-1">{counts.open} open tasks</span> across your
            workflows.
          </div>
        </div>
      </Card>

      {/* Live Earn copilot chat (RAG over the 15 brains + Claude) */}
      <EarnChat />

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

          <Card>
            <SectionTitle
              eyebrow={`${BRAINS.length} brains`}
              title="Intelligence layers"
              className="mb-3"
              action={<ListChecks size={15} strokeWidth={1.9} className="text-fg-4" aria-hidden />}
            />
            <div className="flex flex-wrap gap-1.5">
              {BRAINS.map((b) => {
                const Icon = b.icon;
                return (
                  <span
                    key={b.slug}
                    title={b.role}
                    className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[11px] text-fg-2"
                  >
                    <Icon size={12} strokeWidth={1.9} className="text-fg-4" aria-hidden />
                    {b.name}
                  </span>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
