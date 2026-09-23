// app/(app)/wallet/CreditHistory.tsx
// Async server component — renders the org's credit ledger history.
// Reads up to 50 entries newest-first. Best-effort: any failure degrades to
// an empty state, never a crash.
import { getSessionContext } from "@/lib/auth";
import { getLedger } from "@/lib/credits";

// Human-friendly label + styling per ledger reason code.
const REASON_META: Record<
  string,
  { label: string; colorClass: string; icon: string }
> = {
  // Plans + packs
  plan_grant:         { label: "Plan credits",       colorClass: "text-status-success", icon: "◇" },
  pack_purchase:      { label: "Credit pack",         colorClass: "text-status-success", icon: "◇" },
  // Referrals
  referral_welcome:   { label: "Welcome bonus",       colorClass: "text-status-success", icon: "◇" },
  referral_direct:    { label: "Referral reward",     colorClass: "text-status-success", icon: "◇" },
  referral_override:  { label: "Network override",    colorClass: "text-status-success", icon: "◇" },
  referral_milestone: { label: "Milestone bonus",     colorClass: "text-gold-300",    icon: "★" },
  // Gifts
  gift_received:      { label: "Gift received",       colorClass: "text-status-success", icon: "◇" },
  gift_sent:          { label: "Gift sent",           colorClass: "text-status-danger",    icon: "−" },
  // Coupons
  coupon_redemption:  { label: "Coupon redeemed",     colorClass: "text-status-success", icon: "◇" },
  // Loyalty
  loyalty:            { label: "Loyalty bonus",       colorClass: "text-gold-300",    icon: "◇" },
  // Gamification
  task_complete:      { label: "Task reward",         colorClass: "text-status-success", icon: "◇" },
  streak_bonus:       { label: "Streak bonus",        colorClass: "text-status-success", icon: "◇" },
  milestone_bonus:    { label: "Achievement",         colorClass: "text-gold-300",    icon: "★" },
  hub_achievement:    { label: "Hub achievement",     colorClass: "text-gold-300",    icon: "★" },
  quest_complete:     { label: "Quest complete",      colorClass: "text-status-success", icon: "◇" },
  // Stake
  stake_lock:         { label: "Stake locked",        colorClass: "text-status-danger",    icon: "−" },
  stake_release:      { label: "Stake released",      colorClass: "text-status-success", icon: "◇" },
  // AI actions + admin
  spend:              { label: "AI action",           colorClass: "text-status-danger",    icon: "−" },
  manual:             { label: "Manual adjustment",   colorClass: "text-fg-muted",    icon: "○" },
  // Legacy keys kept for historical rows
  free_tier:          { label: "Free-tier grant",     colorClass: "text-status-success", icon: "◇" },
};

function reasonMeta(reason: string | null) {
  return (
    REASON_META[reason ?? ""] ?? {
      label: reason ?? "Unknown",
      colorClass: "text-fg-muted",
      icon: "○",
    }
  );
}

function formatAmount(amount: number) {
  const abs = Math.abs(amount).toLocaleString();
  return amount >= 0 ? `+${abs}` : `−${abs}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function CreditHistory() {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return null;
    const entries = await getLedger(ctx.orgId, 50);

    if (entries.length === 0) {
      return (
        <section className="mt-10">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-gold-300/70">
            Credit history
          </h2>
          <div className="rounded-2xl border border-dashed border-line/60 px-6 py-10 text-center">
            <p className="text-sm text-fg-muted">No transactions yet.</p>
            <p className="mt-1 text-xs text-fg-muted/60">
              Your credits and spend will appear here.
            </p>
          </div>
        </section>
      );
    }

    // Compact-by-default: the section shows a one-line summary of the most
    // recent movement, and the full ledger table opens behind a native
    // <details> expander so the wallet stays short until you ask for detail.
    const latest = entries[0];
    const latestMeta = reasonMeta(latest.reason);

    return (
      <section className="mt-10">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-gold-300/70">
          Credit history
        </h2>

        <details className="group overflow-hidden rounded-2xl border border-line/60 bg-surface-1/30">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-surface-1/50 [&::-webkit-details-marker]:hidden">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className={`font-mono text-base ${latestMeta.colorClass}`}>
                {latestMeta.icon}
              </span>
              <span className="truncate text-fg-secondary">{latestMeta.label}</span>
              <span className={`font-display font-semibold tabular-nums ${latestMeta.colorClass}`}>
                {formatAmount(latest.amount)}
              </span>
              {entries.length > 1 && (
                <span className="hidden font-mono text-[11px] text-fg-muted sm:inline">
                  · +{entries.length - 1} more
                </span>
              )}
            </div>
            <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-fg-muted">
              <span className="hidden sm:inline">Last {entries.length} transactions</span>
              <span className="transition-transform group-open:rotate-180" aria-hidden>
                ▾
              </span>
            </span>
          </summary>

          <div className="border-t border-line/60">
            <div className="space-y-2 p-3 sm:hidden">
              {entries.map((entry) => {
                const meta = reasonMeta(entry.reason);
                return (
                  <article key={entry.id} className="rounded-xl border border-line/60 bg-surface-0/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium text-fg-primary">
                          <span className={`font-mono text-base ${meta.colorClass}`}>{meta.icon}</span>
                          <span className="truncate">{meta.label}</span>
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-fg-muted">{formatDate(entry.created_at)}</p>
                      </div>
                      <span className={`shrink-0 font-display text-lg font-semibold tabular-nums ${meta.colorClass}`}>
                        {formatAmount(entry.amount)}
                      </span>
                    </div>
                    {entry.note ? (
                      <p className="mt-2 line-clamp-2 text-xs leading-snug text-fg-secondary">{entry.note}</p>
                    ) : null}
                  </article>
                );
              })}
            </div>
            <table className="hidden w-full text-sm sm:table">
              <thead>
                <tr className="border-b border-line/60 bg-surface-2/30">
                  <th className="px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                    Type
                  </th>
                  <th className="px-4 py-3 text-right font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                    Credits
                  </th>
                  <th className="hidden px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted sm:table-cell">
                    Note
                  </th>
                  <th className="px-4 py-3 text-right font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => {
                  const meta = reasonMeta(entry.reason);
                  const isLast = i === entries.length - 1;
                  return (
                    <tr
                      key={entry.id}
                      className={isLast ? "" : "border-b border-line/40"}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-base ${meta.colorClass}`}>
                            {meta.icon}
                          </span>
                          <span className="text-fg-secondary">{meta.label}</span>
                        </div>
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-display font-semibold tabular-nums ${meta.colorClass}`}
                      >
                        {formatAmount(entry.amount)}
                      </td>
                      <td className="hidden max-w-[260px] truncate px-4 py-3 text-xs text-fg-muted sm:table-cell">
                        {entry.note ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[11px] text-fg-muted">
                        {formatDate(entry.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    );
  } catch {
    return null;
  }
}
