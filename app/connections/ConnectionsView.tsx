'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Mail, Clock, GitMerge, type LucideIcon } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ProgressBar,
  SectionTitle,
  SegTabs,
  type BadgeTone,
  type TabItem
} from '@/components/ui';

/* ---- Mock data shaped to mirror the real tables ---------------------- */

interface Contact {
  id: string;
  full_name: string;
  company: string;
  title: string;
  primary_email: string;
}

type RelationshipStatus = 'cold' | 'warm' | 'hot';

interface Relationship {
  contact_id: string;
  strength: number; // 0–100
  status: RelationshipStatus;
  last_interaction_at: string; // ISO date
  interaction_count: number;
}

interface WarmIntroduction {
  target: string;
  connector: string;
  strength: number; // 0–100
  rationale: string;
  status: 'suggested' | 'requested' | 'introduced';
}

const CONTACTS: Contact[] = [
  {
    id: 'c-001',
    full_name: 'Dana Whitfield',
    company: 'Sequoia Heritage',
    title: 'Managing Director',
    primary_email: 'dana@sequoiaheritage.com'
  },
  {
    id: 'c-002',
    full_name: 'Priya Nair',
    company: 'Lakeview Endowment',
    title: 'Head of Private Markets',
    primary_email: 'priya.nair@lakeview.edu'
  },
  {
    id: 'c-003',
    full_name: 'Tomás Rivera',
    company: 'Beacon Family Office',
    title: 'Chief Investment Officer',
    primary_email: 'trivera@beaconfo.com'
  },
  {
    id: 'c-004',
    full_name: 'Helen Osei',
    company: 'Crestline Partners',
    title: 'Partner',
    primary_email: 'hosei@crestline.com'
  },
  {
    id: 'c-005',
    full_name: 'Marcus Lee',
    company: 'Northbridge Advisors',
    title: 'Placement Agent',
    primary_email: 'marcus@northbridge.co'
  },
  {
    id: 'c-006',
    full_name: 'Sofia Klein',
    company: 'Aurora Pension',
    title: 'Senior Portfolio Manager',
    primary_email: 'sofia.klein@aurorapension.de'
  }
];

const RELATIONSHIPS: Record<string, Relationship> = {
  'c-001': {
    contact_id: 'c-001',
    strength: 88,
    status: 'hot',
    last_interaction_at: '2026-06-02',
    interaction_count: 24
  },
  'c-002': {
    contact_id: 'c-002',
    strength: 71,
    status: 'warm',
    last_interaction_at: '2026-05-21',
    interaction_count: 12
  },
  'c-003': {
    contact_id: 'c-003',
    strength: 64,
    status: 'warm',
    last_interaction_at: '2026-05-09',
    interaction_count: 9
  },
  'c-004': {
    contact_id: 'c-004',
    strength: 92,
    status: 'hot',
    last_interaction_at: '2026-06-03',
    interaction_count: 31
  },
  'c-005': {
    contact_id: 'c-005',
    strength: 38,
    status: 'cold',
    last_interaction_at: '2026-03-14',
    interaction_count: 4
  },
  'c-006': {
    contact_id: 'c-006',
    strength: 22,
    status: 'cold',
    last_interaction_at: '2026-01-28',
    interaction_count: 2
  }
};

const WARM_INTRODUCTIONS: WarmIntroduction[] = [
  {
    target: 'Sofia Klein',
    connector: 'Helen Osei',
    strength: 92,
    rationale: 'Helen co-invested with Aurora Pension on two prior funds.',
    status: 'suggested'
  },
  {
    target: 'Marcus Lee',
    connector: 'Dana Whitfield',
    strength: 88,
    rationale: 'Dana and Marcus served together on the Sequoia LPAC.',
    status: 'requested'
  },
  {
    target: 'Tomás Rivera',
    connector: 'Priya Nair',
    strength: 71,
    rationale: 'Priya intro-ed your last raise to Beacon; warm history.',
    status: 'suggested'
  }
];

/* ---- Display helpers -------------------------------------------------- */

const STATUS_META: Record<RelationshipStatus, { tone: BadgeTone; label: string }> = {
  cold: { tone: 'azure', label: 'Cold' },
  warm: { tone: 'gold', label: 'Warm' },
  hot: { tone: 'danger', label: 'Hot' }
};

const STATUS_COLOR: Record<RelationshipStatus, string> = {
  cold: 'var(--azure-1)',
  warm: 'var(--gold-1)',
  hot: 'var(--danger)'
};

const INTRO_STATUS_META: Record<WarmIntroduction['status'], { tone: BadgeTone; label: string }> = {
  suggested: { tone: 'neutral', label: 'Suggested' },
  requested: { tone: 'info', label: 'Requested' },
  introduced: { tone: 'success', label: 'Introduced' }
};

const AVATAR_TONE: Record<RelationshipStatus, 'azure' | 'gold' | 'danger'> = {
  cold: 'azure',
  warm: 'gold',
  hot: 'danger'
};

function daysAgo(iso: string): number {
  const then = new Date(iso).getTime();
  const now = new Date('2026-06-04').getTime();
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

function recencyLabel(iso: string): string {
  const d = daysAgo(iso);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.round(d / 7)}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

type SortKey = 'strength' | 'recency' | 'name';

const SORT_TABS: TabItem[] = [
  { id: 'strength', label: 'Warmth' },
  { id: 'recency', label: 'Recency' },
  { id: 'name', label: 'Name' }
];

const STATUS_TABS: TabItem[] = [
  { id: 'all', label: 'All' },
  { id: 'hot', label: 'Hot' },
  { id: 'warm', label: 'Warm' },
  { id: 'cold', label: 'Cold' }
];

interface Row {
  contact: Contact;
  rel: Relationship;
}

function ContactCard({ contact, rel }: Row) {
  const status = STATUS_META[rel.status];
  return (
    <Card clickable className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar name={contact.full_name} size={38} tone={AVATAR_TONE[rel.status]} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-fg-1">{contact.full_name}</div>
          <div className="truncate text-[11.5px] text-fg-4">
            {contact.title} · {contact.company}
          </div>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-fg-4">
          <span>Warmth score</span>
          <span className="font-semibold tabular-nums text-fg-2">{rel.strength}</span>
        </div>
        <ProgressBar value={rel.strength} color={STATUS_COLOR[rel.status]} height={5} />
      </div>

      <div className="flex items-center justify-between text-[11px] text-fg-5">
        <span className="inline-flex items-center gap-1.5">
          <Clock size={12} strokeWidth={1.9} aria-hidden />
          {recencyLabel(rel.last_interaction_at)}
        </span>
        <span className="tabular-nums">{rel.interaction_count} touchpoints</span>
        <span className="inline-flex items-center gap-1.5 truncate">
          <Mail size={12} strokeWidth={1.9} aria-hidden />
          <span className="truncate">{contact.primary_email}</span>
        </span>
      </div>
    </Card>
  );
}

function WarmIntroRow({ intro }: { intro: WarmIntroduction }) {
  const meta = INTRO_STATUS_META[intro.status];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-hairline bg-surface-1 p-3.5">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
        <GitMerge size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-fg-1">
          <span className="font-semibold">{intro.connector}</span>
          <span className="text-fg-4"> can intro you to </span>
          <span className="font-semibold">{intro.target}</span>
        </div>
        <div className="mt-1 text-[11.5px] leading-snug text-fg-4">{intro.rationale}</div>
        <div className="mt-2 flex items-center gap-2">
          <Badge tone={meta.tone} className="px-2 py-0.5 text-[10.5px]">
            {meta.label}
          </Badge>
          <span className="text-[11px] tabular-nums text-fg-5">
            Connector strength {intro.strength}
          </span>
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        iconRight={ArrowRight as LucideIcon}
        className="flex-none"
      >
        Request
      </Button>
    </div>
  );
}

export function ConnectionsView() {
  const [sort, setSort] = useState<SortKey>('strength');
  const [filter, setFilter] = useState<string>('all');

  const rows = useMemo<Row[]>(() => {
    const base = CONTACTS.map((contact) => ({ contact, rel: RELATIONSHIPS[contact.id] })).filter(
      (r) => filter === 'all' || r.rel.status === filter
    );
    const sorted = [...base];
    sorted.sort((a, b) => {
      if (sort === 'strength') return b.rel.strength - a.rel.strength;
      if (sort === 'recency')
        return (
          new Date(b.rel.last_interaction_at).getTime() -
          new Date(a.rel.last_interaction_at).getTime()
        );
      return a.contact.full_name.localeCompare(b.contact.full_name);
    });
    return sorted;
  }, [sort, filter]);

  return (
    <div className="grid gap-[18px] lg:grid-cols-[1.6fr_1fr]">
      <div>
        <SectionTitle
          eyebrow="Relationship intelligence"
          title="Warm connections"
          action={
            <SegTabs tabs={SORT_TABS} active={sort} onChange={(id) => setSort(id as SortKey)} />
          }
        />
        <div className="mb-4">
          <SegTabs tabs={STATUS_TABS} active={filter} onChange={setFilter} />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          {rows.map((r) => (
            <ContactCard key={r.contact.id} contact={r.contact} rel={r.rel} />
          ))}
        </div>
      </div>

      <div>
        <SectionTitle
          eyebrow="Suggested by Earn"
          title="Warm introductions"
          action={
            <Badge tone="gold" dot pulse>
              Live
            </Badge>
          }
        />
        <div className="flex flex-col gap-3">
          {WARM_INTRODUCTIONS.map((intro) => (
            <WarmIntroRow key={`${intro.connector}-${intro.target}`} intro={intro} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default ConnectionsView;
