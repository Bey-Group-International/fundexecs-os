'use client';

import { useState, useTransition } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  Megaphone,
  Send,
  TriangleAlert
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import type { FundOverview, LpDocument, LpUpdate } from '@/lib/lp-room/types';
import type { LpRoomTier } from '@/lib/lp-room/public';
import { openPublicLpDocument, submitPublicLpQuestion } from '@/lib/lp-room/public-actions';

/**
 * PublicLpRoom — the read-only external LP surface served at /lp/[token]
 * (and reused as the authenticated in-app "LP preview"). No app chrome, no
 * session: the data is pre-filtered server-side to the link's tier, so this
 * component renders only what it's handed. The one mutation an LP can make is
 * asking a question; they can never answer, and document opens are minted by
 * the server after re-checking the tier.
 *
 * When `interactive` is false (the in-app preview), the composer and document
 * actions are disabled — it shows the manager exactly what an LP would see.
 */

export interface PublicLpRoomProps {
  /** Present only on the real tokenized route; drives the server actions. */
  token?: string;
  tier: LpRoomTier;
  label: string;
  expired: boolean;
  firm: string;
  fund: FundOverview;
  documents: LpDocument[];
  updates: LpUpdate[];
  /** Disable the live actions (used by the in-app preview). */
  interactive?: boolean;
}

const TIER_COPY: Record<LpRoomTier, { badge: string; blurb: string }> = {
  prospect: {
    badge: 'Prospect access',
    blurb: 'A read-only view of the fund the manager is raising.'
  },
  committed: {
    badge: 'Committed LP access',
    blurb: 'A read-only view of the fund you’re committed to.'
  }
};

const STATUS_TONE: Record<FundOverview['status'], 'success' | 'azure' | 'gold' | 'neutral'> = {
  open: 'azure',
  'in-market': 'gold',
  closed: 'success',
  'wound-down': 'neutral'
};

export function PublicLpRoom({
  token,
  tier,
  label,
  expired,
  firm,
  fund,
  documents,
  updates,
  interactive = true
}: PublicLpRoomProps) {
  const live = interactive && Boolean(token);

  if (expired) {
    return (
      <Card className="p-8 text-center">
        <CalendarClock size={22} className="mx-auto text-fg-4" aria-hidden />
        <h1 className="mt-3 text-[16px] font-semibold text-fg-1">This link has expired</h1>
        <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
          {firm} set an expiry on this room. Ask them for a fresh link — access stays in their
          hands, not the URL&rsquo;s.
        </p>
      </Card>
    );
  }

  const tierCopy = TIER_COPY[tier];

  return (
    <div className="flex flex-col gap-4">
      {/* ── header / fund overview ─────────────────────────────────────── */}
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Lock size={20} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-fg-1">{fund.name}</h1>
            <p className="text-[12px] text-fg-4">
              {label} · Shared by <b className="text-fg-2">{firm}</b>
            </p>
          </div>
          <Badge tone="gold" className="flex-none">
            {tierCopy.badge}
          </Badge>
        </div>
        {fund.oneLiner && (
          <p className="text-[12.5px] leading-relaxed text-fg-3">{fund.oneLiner}</p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Vintage" value={String(fund.vintage)} />
          <Stat label="Strategy" value={fund.strategy || '—'} />
          <Stat
            label="Status"
            value={
              <Badge tone={STATUS_TONE[fund.status]} dot>
                {fund.status}
              </Badge>
            }
          />
          <Stat label="Target size" value={fund.sizeTarget} />
          <Stat label="Committed" value={fund.committed} />
          <Stat label="Called" value={fund.called} />
          {fund.dpi && <Stat label="DPI" value={fund.dpi} />}
          {fund.tvpi && <Stat label="TVPI" value={fund.tvpi} />}
          {fund.nextClose && <Stat label="Next close" value={fund.nextClose} />}
        </div>
      </Card>

      {/* ── update feed ────────────────────────────────────────────────── */}
      <Card className="flex flex-col gap-4 p-6">
        <SectionTitle icon={Megaphone}>Fund updates</SectionTitle>
        {updates.length === 0 ? (
          <Empty>No updates have been posted yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-4">
            {updates.map((u) => (
              <li key={u.id} className="border-l-2 border-hairline pl-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium text-fg-1">{u.title}</span>
                  <span className="flex-none text-[11px] text-fg-5">{u.postedAt}</span>
                </div>
                <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-fg-3">
                  {u.body}
                </p>
                {u.author && (
                  <p className="mt-1.5 text-[11px] text-fg-5">
                    {u.author}
                    {u.authorRole ? ` · ${u.authorRole}` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── document vault (tier-filtered) ─────────────────────────────── */}
      <Card className="flex flex-col gap-4 p-6">
        <SectionTitle icon={FileText}>Documents</SectionTitle>
        {documents.length === 0 ? (
          <Empty>No documents are available at your access level yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((doc) => (
              <DocumentRow key={doc.id} doc={doc} token={token} live={live} />
            ))}
          </ul>
        )}
      </Card>

      {/* ── ask a question ─────────────────────────────────────────────── */}
      <QuestionComposer token={token} firm={firm} live={live} />

      <p className="text-center text-[11px] text-fg-5">
        Access to this room is logged · Powered by FundExecs OS
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-2.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-5">
        {label}
      </div>
      <div className="mt-1 text-[13px] font-medium text-fg-1">{value}</div>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  children
}: {
  icon: typeof FileText;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
      <Icon size={14} strokeWidth={1.9} aria-hidden />
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-fg-4">{children}</p>;
}

function DocumentRow({ doc, token, live }: { doc: LpDocument; token?: string; live: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function open() {
    if (!live || !token) return;
    setError(null);
    start(async () => {
      const res = await openPublicLpDocument({ token, documentId: doc.id });
      if (res.ok) {
        window.open(res.signedUrl, '_blank', 'noopener,noreferrer');
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <li className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 px-3.5 py-2.5">
      <FileText size={16} className="flex-none text-fg-4" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-fg-1">{doc.name}</div>
        <div className="text-[11px] text-fg-5">
          {doc.sizeMb} · {doc.uploadedAt}
          {doc.signed ? ' · signed' : ''}
        </div>
        {error && (
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-danger" role="alert">
            <TriangleAlert size={12} aria-hidden />
            {error}
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        icon={pending ? Loader2 : undefined}
        disabled={!live || pending}
        onClick={open}
        className="flex-none"
      >
        {live ? (pending ? 'Opening…' : 'Open') : 'Preview'}
      </Button>
    </li>
  );
}

function QuestionComposer({ token, firm, live }: { token?: string; firm: string; live: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  const ready = name.trim().length > 0 && email.trim().length > 3 && body.trim().length > 0;

  function submit() {
    if (!live || !token) return;
    setError(null);
    start(async () => {
      const res = await submitPublicLpQuestion({ token, name, email, body });
      if (res.ok) {
        setSent(true);
        setBody('');
      } else {
        setError(res.error);
      }
    });
  }

  if (sent) {
    return (
      <Card className="flex items-center gap-2.5 p-5 text-[12.5px] leading-relaxed text-fg-3">
        <CheckCircle2 size={16} className="flex-none text-success" aria-hidden />
        Your question has reached {firm}. They&rsquo;ll follow up at the email you provided.
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-6">
      <SectionTitle icon={Send}>Ask {firm} a question</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          maxLength={120}
          autoComplete="name"
          disabled={!live}
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@firm.com"
          maxLength={200}
          autoComplete="email"
          disabled={!live}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="lp-question" className="text-[12.5px] font-medium text-fg-3">
          Question
        </label>
        <textarea
          id="lp-question"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What would you like to ask?"
          maxLength={4000}
          rows={3}
          disabled={!live}
          className="w-full rounded-xl border border-hairline bg-surface-2 px-3 py-2.5 text-sm text-fg-1 outline-none transition placeholder:text-fg-4 focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)] disabled:opacity-60"
        />
      </div>
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger"
        >
          <TriangleAlert size={15} aria-hidden />
          {error}
        </div>
      )}
      <Button
        icon={pending ? Loader2 : Send}
        disabled={!live || !ready || pending}
        onClick={submit}
        className="self-start"
      >
        {pending ? 'Sending…' : 'Send question'}
      </Button>
      {!live && <p className="text-[11px] text-fg-5">Preview mode — the composer is disabled.</p>}
    </Card>
  );
}
