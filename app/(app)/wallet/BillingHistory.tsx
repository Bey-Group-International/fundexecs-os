import { getSessionContext } from "@/lib/auth";
import { listSubscriptionEvents } from "@/lib/subscriptions.server";
import { formatUsd, formatCredits } from "@/lib/billing";
import { formatBillingDate } from "@/lib/subscriptions";

// Every charge, grant, plan change and cancellation on the subscription, newest
// first. The credit ledger below already shows what was granted; this answers the
// separate question of what was BILLED, which nothing in the product could
// previously tell an operator.
const KIND_LABEL: Record<string, string> = {
  created: "Subscription started",
  renewed: "Renewed",
  upgraded: "Upgraded",
  downgrade_scheduled: "Plan change scheduled",
  downgrade_applied: "Plan change applied",
  canceled: "Cancellation scheduled",
  resumed: "Cancellation withdrawn",
  payment_failed: "Payment failed",
  ended: "Subscription ended",
};

export async function BillingHistory() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return null;

  const events = await listSubscriptionEvents(ctx.orgId);
  if (events.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-gold-300/70">
        Billing history
      </h2>
      <div className="overflow-hidden rounded-2xl border border-line/60 bg-surface-1/30">
        <ul className="divide-y divide-line/40">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
              <span
                className={`text-sm font-medium ${
                  e.kind === "payment_failed" || e.kind === "ended"
                    ? "text-status-danger"
                    : "text-fg-primary"
                }`}
              >
                {KIND_LABEL[e.kind] ?? e.kind}
              </span>
              {e.note ? <span className="text-xs text-fg-secondary">{e.note}</span> : null}
              <span className="ml-auto flex items-baseline gap-3 font-mono text-[11px] text-fg-muted">
                {e.credits_granted > 0 ? (
                  <span className="text-gold-300">+{formatCredits(e.credits_granted)} credits</span>
                ) : null}
                {e.amount_usd > 0 ? (
                  <span className="tabular-nums text-fg-secondary">{formatUsd(e.amount_usd)}</span>
                ) : null}
                <span className="tabular-nums">{formatBillingDate(e.created_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
