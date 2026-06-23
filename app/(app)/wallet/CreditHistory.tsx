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
  free_tier: {
    label: "Free-tier grant",
    colorClass: "text-emerald-600",
    icon: "◇",
  },
  gift: { label: "Credit gift", colorClass: "text-emerald-600", icon: "◇" },
  referral: {
    label: "Referral reward",
    colorClass: "text-emerald-600",
    icon: "◇",
  },
  referral_l1: {
    label: "Referral L1",
    colorClass: "text-emerald-600",
    icon: "◇",
  },
  referral_l2: {
    label: "Referral L2",
    colorClass: "text-emerald-500",
    icon: "◇",
  },
  referral_l3: {
    label: "Referral L3",
    colorClass: "text-emerald-400",
    icon: "◇",
  },
  milestone: {
    label: "Milestone bonus",
    colorClass: "text-emerald-600",
    icon: "◇",
  },
  subscription: {
    label: "Plan renewal",
    colorClass: "text-emerald-600",
    icon: "◇",
  },
  loyalty: {
    label: "Loyalty bonus",
    colorClass: "text-emerald-600",
    icon: "◇",
  },
  spend: { label: "AI action", colorClass: "text-rose-500", icon: "−" },
  manual: { label: "Manual adjustment", colorClass: "text-fg", icon: "○" },
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
        <section className="mt-8">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.24em] text-neural-300">
            Credit history
          </h2>
          <div className="rounded-2xl border border-dashed border-neural-400/25 px-6 py-10 text-center">
            <p className="text-sm text-fg-muted">No transactions yet.</p>
            <p className="mt-1 text-xs text-fg-muted/60">
              Your credits and spend will appear here.
            </p>
          </div>
        </section>
      );
    }

    return (
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-[0.24em] text-neural-300">
            Credit history
          </h2>
          <span className="font-mono text-[11px] text-fg-muted">
            Last {entries.length} transactions
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-neural-400/20 bg-black/45">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neural-400/15">
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Type
                </th>
                <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Credits
                </th>
                <th className="hidden px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted sm:table-cell">
                  Note
                </th>
                <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
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
                    className={
                      isLast ? "" : "border-b border-neural-400/10"
                    }
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono text-base ${meta.colorClass}`}
                        >
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
      </section>
    );
  } catch {
    return null;
  }
}
