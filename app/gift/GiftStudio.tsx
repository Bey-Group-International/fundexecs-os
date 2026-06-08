'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { ArrowRight, Gift, Loader2, Sparkles, Users } from 'lucide-react';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { cn } from '@/lib/utils';
import { CUSTOM_CREDIT_DOLLARS, creditsForDollars } from '@/lib/billing/credit-packs';
import { createGiftCheckout } from '@/lib/actions/gift';
import { GiftShareCard } from './GiftShareCard';

/* ============================================================================
 * GiftStudio — the /gift purchase surface.
 *
 * "Give a gift" tab: pick a credit amount, address it to a recipient, and watch
 * a live gift-card preview update as you type, then check out via Stripe.
 * "Refer a manager" tab: the existing share-a-link card. Public + reactive.
 * ========================================================================= */

type Tab = 'gift' | 'refer';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MESSAGE_MAX = 280;

function formatOccasion(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

/** The live, reactive gift-card preview. */
function GiftPreview({
  credits,
  recipientName,
  senderName,
  message,
  occasion
}: {
  credits: number;
  recipientName: string;
  senderName: string;
  message: string;
  occasion: string | null;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--gold-line)] bg-[linear-gradient(150deg,rgba(247,201,72,0.16),rgba(247,201,72,0.03)_55%,transparent)] p-5">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-gold-1">
          FundExecs gift
        </span>
        <EarnCoin size={30} glow />
      </div>

      <div className="mt-5 flex items-end gap-1.5">
        <span className="text-[40px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-fg-1">
          {credits.toLocaleString()}
        </span>
        <span className="mb-1 text-[13px] font-medium text-fg-3">Earn credits</span>
      </div>

      <div className="mt-5 space-y-1.5 text-[12.5px]">
        <p className="text-fg-3">
          <span className="text-fg-5">To </span>
          <span className="font-medium text-fg-1">{recipientName.trim() || 'your recipient'}</span>
        </p>
        <p className="text-fg-3">
          <span className="text-fg-5">From </span>
          <span className="font-medium text-fg-1">{senderName.trim() || 'you'}</span>
        </p>
      </div>

      {message.trim() ? (
        <p className="mt-4 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3 py-2 text-[12.5px] italic leading-6 text-fg-2">
          “{message.trim()}”
        </p>
      ) : null}

      {occasion ? <p className="mt-4 text-[11px] text-fg-4">For {occasion}</p> : null}
    </div>
  );
}

function Field({
  label,
  children,
  hint
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-4">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1 text-[11px] text-fg-5">{hint}</p> : null}
    </label>
  );
}

const INPUT_CLASS =
  'w-full rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-[13px] text-fg-1 placeholder:text-fg-5 transition focus:border-[var(--azure-line)] focus:outline-none';

export function GiftStudio() {
  const [tab, setTab] = useState<Tab>('gift');
  const [amount, setAmount] = useState<number>(40);
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [senderName, setSenderName] = useState('');
  const [message, setMessage] = useState('');
  const [occasionDate, setOccasionDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startCheckout] = useTransition();
  const [canceled, setCanceled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('status') === 'cancel') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCanceled(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('status');
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  const credits = creditsForDollars(amount);
  const occasion = useMemo(() => formatOccasion(occasionDate), [occasionDate]);
  const emailValid = EMAIL_RE.test(recipientEmail.trim());

  function buy() {
    setError(null);
    if (!emailValid) {
      setError('Enter a valid recipient email.');
      return;
    }
    startCheckout(async () => {
      try {
        const res = await createGiftCheckout({
          amountDollars: amount,
          recipientName,
          recipientEmail,
          senderName,
          message,
          occasionDate
        });
        if (res.ok && res.url) {
          window.location.assign(res.url);
          return;
        }
        setError(res.error ?? 'Could not start checkout.');
      } catch {
        setError('Could not start checkout. Please try again.');
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="inline-flex items-center gap-1 rounded-xl border border-hairline bg-surface-1 p-1">
        {(
          [
            { id: 'gift', label: 'Give a gift', icon: Gift },
            { id: 'refer', label: 'Refer a manager', icon: Users }
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={active}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition',
                active ? 'bg-white text-[#070b14]' : 'text-fg-3 hover:text-fg-1'
              )}
            >
              <Icon size={13} strokeWidth={2} aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'refer' ? (
        <GiftShareCard />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Form */}
          <div className="space-y-5">
            {canceled ? (
              <p className="rounded-xl border border-hairline bg-surface-1 px-3 py-2 text-[12px] text-fg-3">
                Checkout canceled — no charge was made.
              </p>
            ) : null}

            <Field label="Gift amount">
              <div className="grid grid-cols-3 gap-2">
                {CUSTOM_CREDIT_DOLLARS.map((d) => {
                  const active = amount === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setAmount(d)}
                      className={cn(
                        'flex flex-col items-start rounded-xl border px-3 py-2 text-left transition',
                        active
                          ? 'border-[var(--gold-line)] bg-[var(--gold-soft)]'
                          : 'border-hairline bg-surface-1 hover:bg-surface-2'
                      )}
                    >
                      <span className="text-[14px] font-semibold tabular-nums text-fg-1">${d}</span>
                      <span className="text-[10.5px] text-fg-4">
                        {creditsForDollars(d).toLocaleString()} credits
                      </span>
                    </button>
                  );
                })}
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Recipient name">
                <input
                  className={INPUT_CLASS}
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Jordan Rivera"
                  maxLength={120}
                />
              </Field>
              <Field label="Recipient email">
                <input
                  className={cn(
                    INPUT_CLASS,
                    recipientEmail && !emailValid && 'border-[var(--danger-line)]'
                  )}
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="jordan@fund.com"
                  type="email"
                  inputMode="email"
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your name">
                <input
                  className={INPUT_CLASS}
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="From…"
                  maxLength={120}
                />
              </Field>
              <Field label="Occasion date" hint="Shown on the gift card (optional).">
                <input
                  className={INPUT_CLASS}
                  value={occasionDate}
                  onChange={(e) => setOccasionDate(e.target.value)}
                  type="date"
                />
              </Field>
            </div>

            <Field label="Personal message">
              <textarea
                className={cn(INPUT_CLASS, 'min-h-[88px] resize-y')}
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
                placeholder="Add a note they'll see when they open the gift…"
                maxLength={MESSAGE_MAX}
              />
              <p className="mt-1 text-right text-[10.5px] text-fg-5">
                {message.length}/{MESSAGE_MAX}
              </p>
            </Field>

            {error ? (
              <p
                role="alert"
                className="rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-danger"
              >
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={buy}
              disabled={pending || !emailValid}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#F7C948,#E5A823)] px-4 py-2.5 text-[13px] font-semibold text-[#070b14] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {pending ? (
                <Loader2 size={15} strokeWidth={2.2} className="animate-spin" aria-hidden />
              ) : (
                <Sparkles size={15} strokeWidth={2} aria-hidden />
              )}
              {pending ? 'Starting checkout…' : `Continue · $${amount}`}
              {!pending ? <ArrowRight size={15} strokeWidth={2} aria-hidden /> : null}
            </button>
            <p className="text-[11px] text-fg-5">
              They&apos;ll get an email with a link to redeem {credits.toLocaleString()} credits
              into their workspace. Credits never expire.
            </p>
          </div>

          {/* Live preview */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <GiftPreview
              credits={credits}
              recipientName={recipientName}
              senderName={senderName}
              message={message}
              occasion={occasion}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default GiftStudio;
