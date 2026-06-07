'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { GitMerge, MessageSquarePlus } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { Drawer } from './Drawer';
import { logInteraction, requestWarmIntro } from '@/lib/actions/connections';
import { EarnContextProvider } from '@/components/shell/earn/EarnContext';

export interface ContactDetailData {
  id: string;
  fullName: string;
  company: string | null;
  title: string | null;
  email: string | null;
  recentInteractions: Array<{
    id: string;
    type: string;
    subject: string | null;
    summary: string | null;
    occurredAt: string;
  }>;
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const d = Math.max(0, Math.round((Date.now() - t) / 86_400_000));
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.round(d / 7)}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

export function ContactDetailDrawer({
  open,
  onClose,
  contact
}: {
  open: boolean;
  onClose: () => void;
  contact: ContactDetailData | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [introRationale, setIntroRationale] = useState('');

  // Reset local state when a different contact is opened.
  const contactKey = contact?.id ?? null;
  const [seededKey, setSeededKey] = useState<string | null>(null);
  if (contactKey !== seededKey) {
    setSeededKey(contactKey);
    setNote('');
    setIntroRationale('');
    setError(null);
  }

  if (!contact) return null;

  function handleLogNote() {
    if (!contact || pending) return;
    if (!note.trim()) {
      setError('Add a note before saving.');
      return;
    }
    startTransition(async () => {
      const r = await logInteraction({
        contactId: contact.id,
        type: 'manual_note',
        subject: note.trim().slice(0, 80),
        summary: note.trim()
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNote('');
      setError(null);
      router.refresh();
    });
  }

  function handleRequestIntro() {
    if (!contact || pending) return;
    startTransition(async () => {
      const r = await requestWarmIntro({
        contactId: contact.id,
        rationale: introRationale.trim() || null
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setIntroRationale('');
      setError(null);
      router.refresh();
    });
  }

  return (
    <EarnContextProvider
      value={{ kind: 'lp', entityId: contact.id, entityLabel: contact.fullName }}
    >
      <Drawer
        open={open}
        onClose={onClose}
        title={contact.fullName}
        subtitle={
          [contact.title, contact.company].filter(Boolean).join(' · ') || contact.email || ''
        }
        footer={
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="contact-detail-close">
            Close
          </Button>
        }
      >
        <div className="flex flex-col gap-5">
          <section>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Log a note
            </div>
            <p className="mt-1 text-[11.5px] text-fg-5">
              Manual notes count as interactions and re-warm the relationship.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Quick context — what you discussed, next steps, anything Earn should know."
                rows={4}
                className="w-full resize-y rounded-xl border border-hairline bg-surface-2 px-3 py-2.5 text-sm text-fg-1 placeholder:text-fg-4 outline-none transition focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                data-testid="contact-note-body"
              />
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={MessageSquarePlus}
                  onClick={handleLogNote}
                  disabled={pending || !note.trim()}
                  data-testid="contact-note-save"
                >
                  Save note
                </Button>
              </div>
            </div>
          </section>

          <section>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Request a warm intro
            </div>
            <p className="mt-1 text-[11.5px] text-fg-5">
              Earn will route the request through your strongest connector.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Input
                aria-label="Intro rationale"
                placeholder="Why this intro matters (optional)"
                value={introRationale}
                onChange={(e) => setIntroRationale(e.target.value)}
                data-testid="contact-intro-rationale"
              />
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  icon={GitMerge}
                  onClick={handleRequestIntro}
                  disabled={pending}
                  data-testid="contact-intro-request"
                >
                  Request intro
                </Button>
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Recent interactions
              </span>
              <span className="text-[11px] tabular-nums text-fg-5">
                {contact.recentInteractions.length} logged
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {contact.recentInteractions.length === 0 ? (
                <p className="text-[12px] text-fg-5">No interactions logged yet.</p>
              ) : (
                contact.recentInteractions.map((i) => (
                  <div
                    key={i.id}
                    className="rounded-md border border-hairline bg-surface-1 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12.5px] font-semibold text-fg-1">
                        {i.subject ?? i.type}
                      </span>
                      <span className="font-mono text-[10.5px] text-fg-5">
                        {relTime(i.occurredAt)}
                      </span>
                    </div>
                    {i.summary ? (
                      <p className="mt-1 line-clamp-2 text-[11.5px] text-fg-4">{i.summary}</p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-danger"
            >
              {error}
            </div>
          ) : null}
        </div>
      </Drawer>
    </EarnContextProvider>
  );
}

export default ContactDetailDrawer;
