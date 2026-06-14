'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  CalendarClock,
  Coins,
  FileText,
  Loader2,
  MessageSquare,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { SegTabs } from '@/components/ui/Tabs';
import { openLpDocument, submitLpQuestion } from '@/lib/actions/lp-room';
import { answerLpQuestionWithEarn } from '@/lib/actions/lp-room-answer';
import type {
  CommitmentScheduleRow,
  DistributionItem,
  LpDocument,
  LpQuestion,
  LpRoomData,
  LpUpdate,
  LpUpdateLifecycle
} from '@/lib/lp-room/types';

/* ============================================================================
 * components/lp-room/LpRoomFlow — the manager-side LP Room.
 *
 * Fund overview · commitment tracker · document vault · update feed ·
 * Earn-answered LP Q&A, all over the live `getLpRoomData` payload. Documents
 * open through signed URLs; the GP answers questions with Earn (grounded in
 * approved materials). Nothing here is illustrative — empty states are honest.
 * ========================================================================= */

const inputClass =
  'w-full rounded-[10px] border border-hairline bg-surface-1 px-3 py-2 text-[12.5px] text-fg-1 outline-none transition focus:border-[var(--accent-line)] focus:bg-surface-2';

const FUND_STATUS_TONE: Record<string, BadgeTone> = {
  open: 'azure',
  'in-market': 'gold',
  closed: 'success',
  'wound-down': 'neutral'
};

const LIFECYCLE_TONE: Record<LpUpdateLifecycle, string> = {
  mandate: 'var(--fg-4)',
  'source-raise': 'var(--azure-1)',
  'analyze-package': 'var(--info)',
  'communicate-close': 'var(--gold-1)',
  reporting: 'var(--success)'
};

const COMMITMENT_TONE: Record<CommitmentScheduleRow['status'], BadgeTone> = {
  committed: 'gold',
  called: 'success',
  distributed: 'azure',
  'in-progress': 'neutral'
};

const DISTRIBUTION_LABEL: Record<DistributionItem['kind'], string> = {
  return_of_capital: 'Return of capital',
  profit: 'Profit',
  dividend: 'Dividend',
  recallable: 'Recallable',
  special: 'Special',
  other: 'Distribution'
};

const DISTRIBUTION_TONE: Record<DistributionItem['status'], BadgeTone> = {
  paid: 'success',
  pending: 'gold',
  cancelled: 'neutral'
};

function money(n: number, currency = 'USD'): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0
  }).format(n);
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
      {children}
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
      <div className="text-[10.5px] text-fg-4">{label}</div>
      <div
        className="mt-1 text-[16px] font-semibold [font-feature-settings:'tnum']"
        style={{ color: tone ?? 'var(--fg-1)' }}
      >
        {value}
      </div>
    </div>
  );
}

/* ── Overview ──────────────────────────────────────────────────────────── */

function OverviewTab({ data }: { data: LpRoomData }) {
  const { fund, capitalAccount, distributions } = data;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-[18px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Eyebrow>Fund overview · on the record</Eyebrow>
            <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-fg-1">{fund.name}</h2>
            {fund.oneLiner && (
              <p className="mt-1 max-w-[68ch] text-[12.5px] leading-relaxed text-fg-3">
                {fund.oneLiner}
              </p>
            )}
          </div>
          <Badge tone={FUND_STATUS_TONE[fund.status] ?? 'neutral'} className="flex-none capitalize">
            {fund.status.replace('-', ' ')}
          </Badge>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          <StatTile label="Vintage" value={String(fund.vintage)} />
          <StatTile label="Strategy" value={fund.strategy} />
          <StatTile label="Target" value={fund.sizeTarget} tone="var(--gold-1)" />
          <StatTile label="Committed" value={fund.committed} tone="var(--success)" />
          <StatTile label="Called" value={fund.called} />
          {fund.dpi && <StatTile label="DPI" value={fund.dpi} />}
          {fund.tvpi && <StatTile label="TVPI" value={fund.tvpi} tone="var(--gold-1)" />}
          {fund.irr && <StatTile label="Net IRR" value={fund.irr} tone="var(--success)" />}
          {fund.nextClose && <StatTile label="Next close" value={fund.nextClose} />}
        </div>
      </Card>

      <Card className="p-[18px]">
        <Eyebrow>Capital account · what an LP checks first</Eyebrow>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatTile label="Committed" value={money(capitalAccount.committed)} />
          <StatTile label="Called" value={money(capitalAccount.called)} />
          <StatTile
            label="Distributed"
            value={money(capitalAccount.distributed)}
            tone="var(--success)"
          />
          <StatTile
            label="NAV"
            value={capitalAccount.navBalance !== null ? money(capitalAccount.navBalance) : '—'}
            tone="var(--azure-1)"
          />
        </div>
      </Card>

      <Card className="p-[18px]">
        <Eyebrow>Distributions</Eyebrow>
        {distributions.length === 0 ? (
          <p className="text-[12px] text-fg-5">
            No distributions on record yet — they post here as the fund returns capital.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {distributions.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-3 rounded-[11px] border border-hairline bg-surface-1 px-3.5 py-2.5"
              >
                <Coins size={15} className="flex-none text-gold-1" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold text-fg-1">
                    {DISTRIBUTION_LABEL[d.kind]}
                  </div>
                  <div className="text-[10.5px] text-fg-5">
                    {d.distributionDate}
                    {d.memo ? ` · ${d.memo}` : ''}
                  </div>
                </div>
                <span className="text-[13px] font-semibold text-fg-1 [font-feature-settings:'tnum']">
                  {money(d.amount)}
                </span>
                <Badge tone={DISTRIBUTION_TONE[d.status]} className="flex-none capitalize">
                  {d.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── Commitments ───────────────────────────────────────────────────────── */

function CommitmentsTab({ data }: { data: LpRoomData }) {
  const { commitments } = data;
  return (
    <Card className="p-[18px]">
      <Eyebrow>Commitment tracker · interest to close</Eyebrow>
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile label="Committed" value={commitments.committed} tone="var(--gold-1)" />
        <StatTile label="Called" value={commitments.called} tone="var(--success)" />
        <StatTile label="Distributed" value={commitments.distributed} />
        <StatTile label="Remaining" value={commitments.remaining} />
      </div>
      {commitments.schedule.length === 0 ? (
        <p className="text-[12px] text-fg-5">
          No commitments on record yet — LPs land here from your capital map as they commit.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {commitments.schedule.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-3 rounded-[11px] border border-hairline bg-surface-1 px-3.5 py-2.5"
            >
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-hairline bg-surface-2 text-[11px] font-bold text-fg-3">
                {row.initials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold capitalize text-fg-1">
                  {row.persona}
                </div>
                <div className="text-[10.5px] text-fg-5">
                  {row.city} · {row.when}
                </div>
              </div>
              <div className="flex-none text-right">
                <div className="text-[12.5px] font-semibold text-fg-1 [font-feature-settings:'tnum']">
                  {row.committed}
                </div>
                <div className="text-[10px] text-fg-5">{row.called} called</div>
              </div>
              <Badge tone={COMMITMENT_TONE[row.status]} className="flex-none capitalize">
                {row.status.replace('-', ' ')}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── Documents ─────────────────────────────────────────────────────────── */

function DocumentsTab({ documents }: { documents: LpDocument[] }) {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(doc: LpDocument) {
    setOpeningId(doc.id);
    setError(null);
    try {
      const res = await openLpDocument(doc.id);
      if (res.ok) window.open(res.signedUrl, '_blank', 'noopener,noreferrer');
      else setError(res.error);
    } catch {
      setError('Could not open the document — try again.');
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <Card className="p-[18px]">
      <Eyebrow>Document vault · vetted access</Eyebrow>
      {error && <p className="mb-2 text-[12px] text-danger">{error}</p>}
      {documents.length === 0 ? (
        <p className="text-[12px] text-fg-5">
          No documents in the room yet — your LPA, subscription docs, reports, and notices live here
          once added.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 rounded-[11px] border border-hairline bg-surface-1 px-3.5 py-2.5"
            >
              <FileText size={16} className="flex-none text-fg-3" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12.5px] font-semibold text-fg-1">{doc.name}</span>
                  {doc.signed && (
                    <BadgeCheck size={13} className="flex-none text-success" aria-hidden />
                  )}
                </div>
                <div className="text-[10.5px] capitalize text-fg-5">
                  {doc.kind.replace('-', ' ')} · {doc.sizeMb} · {doc.uploadedAt}
                </div>
              </div>
              <Badge tone="neutral" className="flex-none capitalize">
                {doc.accessLevel.replace('-', ' ')}
              </Badge>
              <Button
                variant="secondary"
                size="sm"
                icon={openingId === doc.id ? Loader2 : FileText}
                disabled={openingId === doc.id}
                onClick={() => open(doc)}
              >
                {openingId === doc.id ? 'Opening…' : 'Open'}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── Updates ───────────────────────────────────────────────────────────── */

function UpdatesTab({ updates }: { updates: LpUpdate[] }) {
  return (
    <Card className="p-[18px]">
      <Eyebrow>Update feed · what changed</Eyebrow>
      {updates.length === 0 ? (
        <p className="text-[12px] text-fg-5">
          No updates posted yet — milestones, deal news, and reporting land here for your LPs.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {updates.map((u) => (
            <div
              key={u.id}
              className="rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
            >
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ background: LIFECYCLE_TONE[u.lifecycle] }}
                  aria-hidden
                />
                <span className="text-[13px] font-semibold text-fg-1">{u.title}</span>
                <span className="ml-auto flex-none text-[10.5px] text-fg-5">{u.postedAt}</span>
              </div>
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-fg-2">{u.body}</p>
              <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-fg-5">
                {u.author && <span>{u.author}</span>}
                {u.authorRole && <span>· {u.authorRole}</span>}
              </div>
              {u.attachments && u.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {u.attachments.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-2 px-2 py-0.5 text-[10.5px] text-fg-3"
                    >
                      <FileText size={11} aria-hidden />
                      {a.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── Q&A ───────────────────────────────────────────────────────────────── */

function QaTab({
  questions,
  canAnswer,
  onToast
}: {
  questions: LpQuestion[];
  canAnswer: boolean;
  onToast: (msg: string) => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [asking, setAsking] = useState(false);
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (!body.trim()) {
      setError('Enter your question first.');
      return;
    }
    setAsking(true);
    setError(null);
    try {
      const res = await submitLpQuestion({ body });
      if (res.ok) {
        setBody('');
        onToast('Question submitted');
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch {
      setError('Could not submit — try again.');
    } finally {
      setAsking(false);
    }
  }

  async function answer(question: LpQuestion) {
    setAnsweringId(question.id);
    setError(null);
    try {
      const res = await answerLpQuestionWithEarn(question.id);
      if (res.ok) {
        onToast('Earn posted an answer');
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch {
      setError('Could not draft an answer — try again.');
    } finally {
      setAnsweringId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-[18px]">
        <Eyebrow>Ask the GP</Eyebrow>
        <textarea
          aria-label="Your question for the GP"
          className={`${inputClass} min-h-[72px] resize-y`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="e.g. How does the management fee step down after the investment period?"
        />
        {error && <p className="mt-2 text-[11.5px] text-danger">{error}</p>}
        <div className="mt-3 flex justify-end">
          <Button
            variant="gold"
            size="sm"
            icon={asking ? Loader2 : Send}
            disabled={asking}
            onClick={ask}
          >
            {asking ? 'Submitting…' : 'Submit question'}
          </Button>
        </div>
      </Card>

      <Card className="p-[18px]">
        <Eyebrow>Q&amp;A · Earn answers from approved materials</Eyebrow>
        {questions.length === 0 ? (
          <p className="text-[12px] text-fg-5">
            No questions yet — when an LP asks, it lands here and Earn drafts the answer for the GP
            to review.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {questions.map((q) => (
              <div
                key={q.id}
                className="rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare size={14} className="flex-none text-fg-4" aria-hidden />
                  <span className="text-[11.5px] font-medium text-fg-3">{q.askedBy}</span>
                  <span className="text-[10.5px] text-fg-5">· {q.askedAt}</span>
                  <Badge
                    tone={q.status === 'answered' ? 'success' : 'gold'}
                    className="ml-auto flex-none capitalize"
                  >
                    {q.status}
                  </Badge>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-fg-1">{q.body}</p>

                {q.thread.map((a) => (
                  <div
                    key={a.id}
                    className="mt-2.5 rounded-[10px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3 py-2.5"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <EarnCoin size={18} />
                      <span className="text-[11.5px] font-semibold text-gold-1">{a.author}</span>
                      {a.authorRole && (
                        <span className="text-[10px] text-fg-5">· {a.authorRole}</span>
                      )}
                      <span className="ml-auto text-[10px] text-fg-5">{a.postedAt}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-fg-2">
                      {a.body}
                    </p>
                    {a.citations && a.citations.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {a.citations.map((c) => (
                          <span
                            key={c.id}
                            className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-2 px-2 py-0.5 text-[10px] text-fg-3"
                          >
                            <FileText size={10} aria-hidden />
                            {c.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {canAnswer && q.status !== 'answered' && (
                  <div className="mt-2.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={answeringId === q.id ? Loader2 : Sparkles}
                      disabled={answeringId === q.id}
                      onClick={() => answer(q)}
                    >
                      {answeringId === q.id ? 'Drafting…' : 'Answer with Earn'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── shell ─────────────────────────────────────────────────────────────── */

type TabId = 'overview' | 'commitments' | 'documents' | 'updates' | 'qa';

export interface LpRoomFlowProps {
  data: LpRoomData;
  /** True when the signed-in member is the GP (owner/admin) who can answer Q&A. */
  canAnswer: boolean;
}

export function LpRoomFlow({ data, canAnswer }: LpRoomFlowProps) {
  const [tab, setTab] = useState<TabId>('overview');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const openQuestions = data.questions.filter((q) => q.status !== 'answered').length;

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
            <TrendingUp size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">LP Room</h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              {data.fund.name} · your investor-ready room, on the record · Eleanor
            </p>
          </div>
          {data.fund.nextClose && (
            <div className="hidden flex-none items-center gap-1.5 rounded-[10px] border border-hairline bg-surface-1 px-3 py-2 text-[11.5px] text-fg-3 sm:flex">
              <CalendarClock size={14} className="text-gold-1" aria-hidden />
              Next close {data.fund.nextClose}
            </div>
          )}
        </div>
      </Card>

      <SegTabs
        active={tab}
        onChange={(id) => setTab(id as TabId)}
        tabs={[
          { id: 'overview', label: 'Overview', icon: TrendingUp },
          { id: 'commitments', label: 'Commitments', icon: Coins },
          { id: 'documents', label: 'Documents', icon: FileText },
          { id: 'updates', label: 'Updates', icon: ShieldCheck },
          {
            id: 'qa',
            label: openQuestions > 0 ? `Q&A · ${openQuestions}` : 'Q&A',
            icon: MessageSquare
          }
        ]}
      />

      {tab === 'overview' && <OverviewTab data={data} />}
      {tab === 'commitments' && <CommitmentsTab data={data} />}
      {tab === 'documents' && <DocumentsTab documents={data.documents} />}
      {tab === 'updates' && <UpdatesTab updates={data.updates} />}
      {tab === 'qa' && (
        <QaTab questions={data.questions} canAnswer={canAnswer} onToast={setToast} />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2.5 rounded-[14px] border border-[var(--success-line)] bg-bg-2 px-4 py-3 shadow-[var(--shadow-lg)]">
          <ShieldCheck size={17} className="text-success" aria-hidden />
          <div className="text-[13px] font-semibold text-fg-1">{toast}</div>
        </div>
      )}
    </div>
  );
}
