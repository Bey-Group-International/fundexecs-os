'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  ArrowUpRight,
  Check,
  CreditCard,
  Loader2,
  Minus,
  Plus,
  Sparkles,
  User,
  Users,
  Zap
} from 'lucide-react';
import { Badge, Button, Card, SectionTitle } from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  PLANS,
  formatUsd,
  plansForGroup,
  planName,
  type BillingInterval,
  type PlanDef,
  type PlanId
} from '@/lib/billing/plans';
import { CUSTOM_CREDIT_DOLLARS, creditsForDollars } from '@/lib/billing/credit-packs';
import {
  createBillingPortalSession,
  createCustomTopUpCheckout,
  createSubscriptionCheckout
} from '@/lib/actions/stripe-checkout';

/* ============================================================================
 * PlanCreditsSection — the Settings "Plan & credits" surface.
 *
 * Claude-upgrade-style grouped plan cards (Individual / Teams) with a
 * monthly–annual toggle, a ChatGPT-admin-style billing summary + "Manage
 * billing", and a custom credit-pack picker. First purchase opens Stripe
 * Checkout; once a subscription exists, plan changes route to the Customer
 * Portal. Every action degrades gracefully when Stripe is not configured.
 * ========================================================================= */

const SALES_EMAIL = 'hello@beygroupintl.com';

export interface PlanCreditsSectionProps {
  /** Current plan id (server-resolved); 'free' when no subscription. */
  currentPlan: PlanId;
  currentInterval: BillingInterval;
  seats: number;
  status: string;
  cancelAtPeriodEnd: boolean;
  /** ISO date the current paid period renews/ends. */
  currentPeriodEnd: string | null;
  /** True when a real subscription row exists (drives checkout vs. portal). */
  hasSubscription: boolean;
  /** Live wallet balance for the credits panel. */
  creditBalance: number;
}

/** Navigate the browser to a Stripe-hosted URL (checkout / portal). */
function redirect(url: string) {
  window.location.assign(url);
}

/** Monthly / Annual segmented toggle. */
function IntervalToggle({
  interval,
  onChange
}: {
  interval: BillingInterval;
  onChange: (i: BillingInterval) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-hairline bg-surface-1 p-1">
      {(['month', 'year'] as const).map((opt) => {
        const active = interval === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={active}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition',
              active ? 'bg-white text-[#070b14]' : 'text-fg-3 hover:text-fg-1'
            )}
          >
            {opt === 'month' ? 'Monthly' : 'Annual'}
            {opt === 'year' ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[10px] font-semibold',
                  active ? 'bg-[#070b14]/10 text-[#070b14]' : 'text-success'
                )}
              >
                Save 50%
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Seat stepper for per-seat plans on first checkout. */
function SeatStepper({ seats, onChange }: { seats: number; onChange: (n: number) => void }) {
  return (
    <div className="mt-3 flex items-center justify-between rounded-lg border border-hairline bg-surface-1 px-2.5 py-1.5">
      <span className="text-[11.5px] text-fg-3">Seats</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Remove a seat"
          onClick={() => onChange(Math.max(1, seats - 1))}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-hairline text-fg-3 transition hover:bg-surface-2 disabled:opacity-40"
          disabled={seats <= 1}
        >
          <Minus size={12} strokeWidth={2.2} aria-hidden />
        </button>
        <span className="w-6 text-center text-[13px] font-semibold tabular-nums text-fg-1">
          {seats}
        </span>
        <button
          type="button"
          aria-label="Add a seat"
          onClick={() => onChange(Math.min(99, seats + 1))}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-hairline text-fg-3 transition hover:bg-surface-2"
        >
          <Plus size={12} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function priceLabel(plan: PlanDef, interval: BillingInterval): { big: string; sub: string } {
  if (plan.kind === 'contact') return { big: 'Custom', sub: 'Contact our team' };
  if (plan.kind === 'free') return { big: '$0', sub: 'Free forever' };
  const cents = interval === 'year' ? plan.annualMonthlyCents : plan.monthlyCents;
  const big = formatUsd(cents ?? 0);
  const per = plan.seatBased ? '/seat/mo' : '/mo';
  const sub = interval === 'year' ? `${big}${per} · billed annually` : `${big}${per}`;
  return { big, sub };
}

function creditsLabel(plan: PlanDef): string {
  if (plan.id === 'free') return '500 starter credits';
  if (plan.creditsPerMonth == null) return 'Custom credit allotment';
  return `${plan.creditsPerMonth.toLocaleString()} credits / month`;
}

function PlanCard({
  plan,
  interval,
  isCurrent,
  hasSubscription,
  seats,
  onSeats,
  onSelect,
  pending,
  busy
}: {
  plan: PlanDef;
  interval: BillingInterval;
  isCurrent: boolean;
  hasSubscription: boolean;
  seats: number;
  onSeats: (n: number) => void;
  onSelect: () => void;
  pending: boolean;
  /** True when any checkout/portal action is in flight (disables all cards). */
  busy: boolean;
}) {
  const { big, sub } = priceLabel(plan, interval);
  const accent =
    plan.tone === 'gold'
      ? 'border-[var(--gold-line)]'
      : plan.tone === 'azure'
        ? 'border-[var(--azure-line)]'
        : 'border-hairline';

  const cta = isCurrent
    ? 'Current plan'
    : plan.kind === 'contact'
      ? 'Contact sales'
      : plan.kind === 'free'
        ? hasSubscription
          ? 'Switch to Free'
          : 'Your plan'
        : hasSubscription
          ? 'Change plan'
          : 'Upgrade';

  const ctaDisabled = isCurrent || (plan.kind === 'free' && !hasSubscription) || pending || busy;
  const showSeats = plan.seatBased && plan.kind === 'paid' && !hasSubscription && !isCurrent;

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-2xl border bg-surface-1 p-4',
        isCurrent ? `${accent} bg-surface-2` : accent
      )}
      data-testid={`plan-card-${plan.id}`}
    >
      {plan.popular && !isCurrent ? (
        <span className="absolute -top-2 right-3 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-gold-1">
          Popular
        </span>
      ) : null}

      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold text-fg-1">{plan.name}</span>
        {isCurrent ? (
          <Badge tone="success" className="px-2 py-0.5 text-[10px]">
            Current
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 min-h-[32px] text-[11.5px] leading-snug text-fg-4">{plan.tagline}</p>

      <div className="mt-2">
        <div className="text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
          {big}
        </div>
        <div className="text-[11px] text-fg-5">{sub}</div>
      </div>

      <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--azure-line)] bg-[var(--azure-soft)] px-2 py-1 text-[11px] font-medium text-azure-1">
        <Zap size={11} strokeWidth={2} aria-hidden />
        {creditsLabel(plan)}
      </div>

      <ul className="mt-3 flex flex-1 flex-col gap-1.5">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-1.5 text-[11.5px] text-fg-3">
            <Check
              size={13}
              strokeWidth={2.2}
              className="mt-0.5 flex-none text-success"
              aria-hidden
            />
            {f}
          </li>
        ))}
      </ul>

      {showSeats ? <SeatStepper seats={seats} onChange={onSeats} /> : null}

      <button
        type="button"
        onClick={onSelect}
        disabled={ctaDisabled}
        className={cn(
          'mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold transition disabled:cursor-default',
          isCurrent
            ? 'border border-hairline bg-transparent text-fg-4'
            : ctaDisabled
              ? 'border border-hairline bg-surface-1 text-fg-4'
              : plan.tone === 'gold'
                ? 'bg-[linear-gradient(135deg,#F7C948,#E5A823)] text-[#070b14] hover:brightness-110'
                : 'bg-[linear-gradient(135deg,#3B74F0,#2152D8)] text-white hover:brightness-110'
        )}
      >
        {pending ? (
          <Loader2 size={13} strokeWidth={2.2} className="animate-spin" aria-hidden />
        ) : plan.kind === 'contact' && !isCurrent ? (
          <ArrowUpRight size={13} strokeWidth={2.2} aria-hidden />
        ) : null}
        {cta}
      </button>
    </div>
  );
}

/**
 * PlanCreditsSection — the Settings "Plan & credits" surface. Renders the
 * billing summary, the monthly/annual plan picker, and the custom credit-pack
 * grid, and drives Stripe checkout / billing-portal flows.
 */
export function PlanCreditsSection({
  currentPlan,
  currentInterval,
  seats: currentSeats,
  status,
  cancelAtPeriodEnd,
  currentPeriodEnd,
  hasSubscription,
  creditBalance
}: PlanCreditsSectionProps) {
  const [interval, setInterval] = useState<BillingInterval>(currentInterval);
  const [seats, setSeats] = useState<number>(Math.max(1, currentSeats));
  const [pendingPlan, setPendingPlan] = useState<PlanId | null>(null);
  const [pendingDollars, setPendingDollars] = useState<number | null>(null);
  const [portalPending, startPortal] = useTransition();
  const [, startAction] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: 'success' | 'info'; text: string } | null>(null);

  // Surface the Stripe return state (?plan=success / ?topup=cancel) once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const plan = params.get('plan');
    const topup = params.get('topup');
    if (!plan && !topup) return;

    const next: { tone: 'success' | 'info'; text: string } | null =
      plan === 'success'
        ? { tone: 'success', text: 'Your plan is being activated — credits land within a moment.' }
        : topup === 'success'
          ? { tone: 'success', text: 'Payment received — your credits are on the way.' }
          : plan === 'cancel' || topup === 'cancel'
            ? { tone: 'info', text: 'Checkout canceled — no charge was made.' }
            : null;

    // One-time read of Stripe's redirect params after mount — not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next) setBanner(next);

    const url = new URL(window.location.href);
    url.searchParams.delete('plan');
    url.searchParams.delete('topup');
    window.history.replaceState(null, '', url.toString());
  }, []);

  const current = PLANS.find((p) => p.id === currentPlan);
  // Single in-flight guard so rapid clicks across cards/packs can't open
  // multiple Stripe sessions at once.
  const checkoutInFlight = pendingPlan !== null || pendingDollars !== null || portalPending;

  /** Route a plan choice: contact-sales (mailto), portal (existing sub), or checkout. */
  function selectPlan(plan: PlanDef) {
    if (checkoutInFlight) return;
    setError(null);
    if (plan.id === currentPlan) return;

    if (plan.kind === 'contact') {
      window.location.assign(
        `mailto:${SALES_EMAIL}?subject=${encodeURIComponent('FundExecs Institution plan')}`
      );
      return;
    }

    // Once a subscription exists, all plan changes (incl. downgrade to Free)
    // go through the Stripe Customer Portal.
    if (hasSubscription) {
      openPortal();
      return;
    }

    if (plan.kind === 'free') return;

    setPendingPlan(plan.id);
    startAction(async () => {
      const res = await createSubscriptionCheckout(plan.id, interval, plan.seatBased ? seats : 1);
      if (res.ok && res.url) redirect(res.url);
      else {
        setError(res.error ?? 'Could not start checkout.');
        setPendingPlan(null);
      }
    });
  }

  /** Open the Stripe Customer Portal to manage an existing subscription. */
  function openPortal() {
    if (checkoutInFlight) return;
    setError(null);
    startPortal(async () => {
      const res = await createBillingPortalSession();
      if (res.ok && res.url) redirect(res.url);
      else setError(res.error ?? 'Could not open billing.');
    });
  }

  /** Start a one-off Stripe checkout for a custom credit pack ($ amount). */
  function buyCredits(dollars: number) {
    if (checkoutInFlight) return;
    setError(null);
    setPendingDollars(dollars);
    startAction(async () => {
      const res = await createCustomTopUpCheckout(
        dollars as (typeof CUSTOM_CREDIT_DOLLARS)[number]
      );
      if (res.ok && res.url) redirect(res.url);
      else {
        setError(res.error ?? 'Could not start checkout.');
        setPendingDollars(null);
      }
    });
  }

  const renew = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    : null;

  return (
    <div className="flex flex-col gap-[18px]">
      {/* ---- Billing summary ---------------------------------------------- */}
      <Card>
        <SectionTitle
          eyebrow="Plan & credits"
          title="Your plan"
          action={
            hasSubscription ? (
              <Button
                variant="primary"
                size="sm"
                icon={CreditCard}
                onClick={openPortal}
                disabled={checkoutInFlight}
              >
                {portalPending ? 'Opening…' : 'Manage billing'}
              </Button>
            ) : undefined
          }
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-hairline bg-surface-1 px-4 py-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Plan
            </p>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[16px] font-semibold text-fg-1">{planName(currentPlan)}</span>
              {current && current.id !== 'free' ? (
                <Badge tone="azure" className="px-1.5 py-px text-[10px]">
                  {currentInterval === 'year' ? 'Annual' : 'Monthly'}
                </Badge>
              ) : null}
            </div>
            <p className="mt-0.5 text-[11px] capitalize text-fg-4">
              {cancelAtPeriodEnd ? 'Cancels at period end' : status.replace(/_/g, ' ')}
            </p>
          </div>
          <div className="rounded-xl border border-hairline bg-surface-1 px-4 py-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Credit balance
            </p>
            <p className="mt-1 text-[16px] font-semibold tabular-nums text-fg-1">
              {creditBalance.toLocaleString()}
              <span className="ml-1 text-[11px] font-normal text-fg-4">credits</span>
            </p>
          </div>
          <div className="rounded-xl border border-hairline bg-surface-1 px-4 py-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              {cancelAtPeriodEnd ? 'Access until' : 'Renews'}
            </p>
            <p className="mt-1 text-[16px] font-semibold text-fg-1">{renew ?? '—'}</p>
          </div>
        </div>

        {banner ? (
          <p
            role="status"
            className={cn(
              'mt-3 rounded-xl border px-3 py-2 text-[12px]',
              banner.tone === 'success'
                ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                : 'border-hairline bg-surface-1 text-fg-3'
            )}
          >
            {banner.text}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2 text-[12px] text-danger"
          >
            {error}
          </p>
        ) : null}
      </Card>

      {/* ---- Plan picker -------------------------------------------------- */}
      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionTitle eyebrow="Plans" title="Choose your plan" />
          <IntervalToggle interval={interval} onChange={setInterval} />
        </div>

        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-4">
          <User size={12} strokeWidth={2} aria-hidden />
          Individual
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {plansForGroup('individual').map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              interval={interval}
              isCurrent={plan.id === currentPlan}
              hasSubscription={hasSubscription}
              seats={seats}
              onSeats={setSeats}
              onSelect={() => selectPlan(plan)}
              pending={pendingPlan === plan.id}
              busy={checkoutInFlight}
            />
          ))}
        </div>

        <div className="mb-2 mt-5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-4">
          <Users size={12} strokeWidth={2} aria-hidden />
          Teams & Enterprise
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {plansForGroup('team').map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              interval={interval}
              isCurrent={plan.id === currentPlan}
              hasSubscription={hasSubscription}
              seats={seats}
              onSeats={setSeats}
              onSelect={() => selectPlan(plan)}
              pending={pendingPlan === plan.id}
              busy={checkoutInFlight}
            />
          ))}
        </div>
      </Card>

      {/* ---- Custom credits ---------------------------------------------- */}
      <Card>
        <SectionTitle
          eyebrow="Credits"
          title="Buy custom credits"
          action={
            <span className="inline-flex items-center gap-1 text-[11px] text-fg-4">
              <Sparkles size={12} strokeWidth={2} className="text-gold-1" aria-hidden />
              100 credits / $1
            </span>
          }
        />
        <p className="-mt-1 mb-3 text-[12px] text-fg-4">
          One-time top-ups that never expire — on top of your plan&apos;s monthly credits.
        </p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {CUSTOM_CREDIT_DOLLARS.map((dollars) => {
            const isPending = pendingDollars === dollars;
            return (
              <button
                key={dollars}
                type="button"
                onClick={() => buyCredits(dollars)}
                disabled={checkoutInFlight}
                className={cn(
                  'flex flex-col items-start rounded-xl border border-hairline bg-surface-1 px-3 py-2.5 text-left transition hover:border-[var(--azure-line)] hover:bg-surface-2 disabled:opacity-60',
                  isPending && 'border-[var(--azure-line)] bg-[var(--azure-soft)]'
                )}
                data-testid={`credit-pack-${dollars}`}
              >
                <span className="flex w-full items-center justify-between">
                  <span className="text-[15px] font-semibold tabular-nums text-fg-1">
                    ${dollars}
                  </span>
                  {isPending ? (
                    <Loader2
                      size={13}
                      strokeWidth={2.2}
                      className="animate-spin text-azure-1"
                      aria-hidden
                    />
                  ) : (
                    <Zap size={13} strokeWidth={2} className="text-azure-1" aria-hidden />
                  )}
                </span>
                <span className="mt-0.5 text-[11.5px] text-fg-4">
                  {creditsForDollars(dollars).toLocaleString()} credits
                </span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
