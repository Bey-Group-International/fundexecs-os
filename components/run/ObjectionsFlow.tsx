'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  CheckCircle2,
  Loader2,
  MessageSquareWarning,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TriangleAlert
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { resolveObjection, upsertObjection } from '@/lib/actions/objections';
import { draftObjectionRebuttal } from '@/lib/actions/objection-rebuttal';
import type { ObjectionItem, ObjectionsData } from '@/lib/queries/objections';

/* ============================================================================
 * components/run/ObjectionsFlow — the Objection Handling Assistant (Eleanor).
 *
 * Log the objections LPs raise, let Earn draft an institutional-grade rebuttal
 * + talking points, save it against the LP, and drive each to resolved. Writes
 * go through the existing `upsert_objection` / `resolve_objection` RPCs.
 * ========================================================================= */

const CATEGORIES = ['Fees', 'Track record', 'Team', 'Strategy', 'Timing', 'Terms', 'Market'];

const inputClass =
  'w-full rounded-[10px] border border-hairline bg-surface-1 px-3 py-2 text-[12.5px] text-fg-1 outline-none transition focus:border-[var(--accent-line)] focus:bg-surface-2';

export interface ObjectionsFlowProps {
  data: ObjectionsData;
}

export function ObjectionsFlow({ data }: ObjectionsFlowProps) {
  const router = useRouter();
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' } | null>(null);

  // Composer state.
  const [lpId, setLpId] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [objection, setObjection] = useState('');
  const [rebuttal, setRebuttal] = useState('');
  const [talkingPoints, setTalkingPoints] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const noLps = data.lps.length === 0;

  async function draft() {
    if (!objection.trim()) {
      setError('Enter the objection first.');
      return;
    }
    setDrafting(true);
    setError(null);
    try {
      const lpName = data.lps.find((l) => l.id === lpId)?.name ?? null;
      const res = await draftObjectionRebuttal({ objection, category, lpName });
      if (res.ok) {
        setRebuttal(res.result.rebuttal);
        setTalkingPoints(res.result.talkingPoints);
      } else {
        setError(res.error);
      }
    } catch {
      setError('Could not draft a rebuttal — try again.');
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    if (!lpId) {
      setError('Select the LP this objection is tied to.');
      return;
    }
    if (!objection.trim()) {
      setError('Enter the objection first.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await upsertObjection({
        lpId,
        category,
        objection,
        rebuttal: rebuttal.trim() || undefined
      });
      if (res.ok) {
        setToast({ msg: 'Objection logged', tone: 'success' });
        setObjection('');
        setRebuttal('');
        setTalkingPoints([]);
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch {
      setError('Could not save — try again.');
    } finally {
      setSaving(false);
    }
  }

  async function markResolved(item: ObjectionItem) {
    setResolvingId(item.id);
    try {
      const res = await resolveObjection(item.id);
      if (res.ok) {
        setToast({ msg: 'Objection resolved', tone: 'success' });
        router.refresh();
      } else {
        setToast({ msg: res.error, tone: 'error' });
      }
    } catch {
      setToast({ msg: 'Could not resolve — try again.', tone: 'error' });
    } finally {
      setResolvingId(null);
    }
  }

  const open = data.items.filter((i) => i.status === 'open');
  const resolved = data.items.filter((i) => i.status === 'resolved');

  return (
    <div className="flex flex-col gap-4">
      {/* posture header */}
      <Card className="p-[18px]">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
            <MessageSquareWarning size={16} strokeWidth={1.9} aria-hidden />
          </span>
          <div>
            <div className="mb-px text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Handle every objection · Eleanor
            </div>
            <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
              Objection handling
            </h2>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
            <div className="text-[10.5px] text-fg-4">Open</div>
            <div className="mt-1 text-[18px] font-semibold text-gold-1 [font-feature-settings:'tnum']">
              {data.openCount}
            </div>
          </div>
          <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
            <div className="text-[10.5px] text-fg-4">Resolved</div>
            <div className="mt-1 text-[18px] font-semibold text-success [font-feature-settings:'tnum']">
              {data.resolvedCount}
            </div>
          </div>
          <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
            <div className="text-[10.5px] text-fg-4">Resolution</div>
            <div className="mt-1 text-[18px] font-semibold text-fg-1 [font-feature-settings:'tnum']">
              {data.resolutionPct}%
            </div>
          </div>
        </div>
      </Card>

      {/* composer */}
      <Card className="p-[18px]">
        <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          Log an objection · Earn drafts the rebuttal
        </div>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-fg-3">LP</span>
              <select className={inputClass} value={lpId} onChange={(e) => setLpId(e.target.value)}>
                <option value="">{noLps ? 'No LPs on your map yet' : 'Select an LP…'}</option>
                {data.lps.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-fg-3">Category</span>
              <select
                className={inputClass}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-fg-3">The objection</span>
            <textarea
              className={`${inputClass} min-h-[72px] resize-y`}
              value={objection}
              onChange={(e) => setObjection(e.target.value)}
              placeholder="e.g. Your 2% management fee is high for a first-time fund."
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={drafting ? Loader2 : Sparkles}
              disabled={drafting}
              onClick={draft}
            >
              {drafting ? 'Drafting…' : 'Draft rebuttal with Earn'}
            </Button>
          </div>

          {(rebuttal || talkingPoints.length > 0) && (
            <div className="rounded-[12px] border border-[var(--gold-line)] bg-[var(--gold-soft)] p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <EarnCoin size={22} />
                <span className="text-[12.5px] font-semibold text-gold-1">
                  Earn&apos;s rebuttal
                </span>
              </div>
              <textarea
                className={`${inputClass} min-h-[96px] resize-y`}
                value={rebuttal}
                onChange={(e) => setRebuttal(e.target.value)}
              />
              {talkingPoints.length > 0 && (
                <ul className="mt-2.5 flex flex-col gap-1.5">
                  {talkingPoints.map((tp, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-[11.5px] leading-relaxed text-fg-2"
                    >
                      <span
                        className="mt-[6px] h-1.5 w-1.5 flex-none rounded-full bg-gold-1"
                        aria-hidden
                      />
                      {tp}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && <p className="text-[11.5px] text-danger">{error}</p>}

          <div className="flex justify-end">
            <Button
              variant="gold"
              size="sm"
              icon={saving ? Loader2 : Check}
              disabled={saving || noLps}
              onClick={save}
            >
              {saving ? 'Saving…' : 'Save objection'}
            </Button>
          </div>
        </div>
      </Card>

      {/* the log */}
      <Card className="p-[18px]">
        <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          Objection log
        </div>
        {data.empty ? (
          <div className="px-4 py-8 text-center">
            <MessageSquareWarning size={22} className="mx-auto text-fg-4" aria-hidden />
            <h3 className="mt-3 text-[15px] font-semibold text-fg-1">No objections logged yet</h3>
            <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
              When an LP pushes back, log it here — Eleanor drafts the rebuttal and you drive every
              concern to resolved.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {[...open, ...resolved].map((item) => {
              const isResolved = item.status === 'resolved';
              return (
                <div
                  key={item.id}
                  className={`rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3 ${
                    isResolved ? 'opacity-70' : ''
                  }`}
                  style={{
                    borderLeftWidth: 2,
                    borderLeftColor: isResolved ? 'var(--success)' : 'var(--gold-1)'
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={isResolved ? 'success' : 'gold'}
                      className="flex-none px-2 py-0.5 text-[9.5px]"
                    >
                      {item.category}
                    </Badge>
                    {item.lpName && (
                      <span className="truncate text-[11px] text-fg-4">{item.lpName}</span>
                    )}
                    <span className="ml-auto flex-none">
                      {isResolved ? (
                        <Badge tone="success" className="px-2 py-0.5 text-[9px]">
                          Resolved
                        </Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={resolvingId === item.id ? Loader2 : CheckCircle2}
                          disabled={resolvingId === item.id}
                          onClick={() => markResolved(item)}
                        >
                          Resolve
                        </Button>
                      )}
                    </span>
                  </div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-fg-1">{item.objection}</p>
                  {item.rebuttal && (
                    <div className="mt-2 flex items-start gap-2 rounded-[10px] border border-hairline bg-surface-2 px-3 py-2">
                      <RotateCcw size={13} className="mt-0.5 flex-none text-gold-1" aria-hidden />
                      <p className="text-[11.5px] leading-relaxed text-fg-3">{item.rebuttal}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Every objection is a chance to build conviction.
          Eleanor drafts a response grounded in your fund story — you decide what to send.
        </p>
      </Card>

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2.5 rounded-[14px] border bg-bg-2 px-4 py-3 shadow-[var(--shadow-lg)] ${
            toast.tone === 'error' ? 'border-[var(--danger-line)]' : 'border-[var(--success-line)]'
          }`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          {toast.tone === 'error' ? (
            <TriangleAlert size={17} className="text-danger" aria-hidden />
          ) : (
            <ShieldCheck size={17} className="text-success" aria-hidden />
          )}
          <div className="text-[13px] font-semibold text-fg-1">{toast.msg}</div>
        </div>
      )}
    </div>
  );
}
