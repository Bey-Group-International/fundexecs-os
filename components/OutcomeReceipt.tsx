import Link from "next/link";
import { fmtClockTime, type OutcomeSummary } from "@/lib/routing-trace-ui";

// A durable, plain-language receipt of what the operator's decision did — so a
// completed/declined workflow always says "this went through", by whom-equivalent
// (you), when, and where it landed (the saved automation). Renders nothing while
// a decision is still pending or absent; the card shows the decision controls
// in that state.

const TONE: Record<string, { ring: string; icon: string; iconColor: string }> = {
  approved: { ring: "border-gold-500/45 bg-gold-500/[0.07]", icon: "✓", iconColor: "text-gold-300" },
  accepted: { ring: "border-status-info/40 bg-status-info/[0.07]", icon: "✓", iconColor: "text-status-info" },
  declined: { ring: "border-line/70 bg-surface-2/50", icon: "×", iconColor: "text-status-danger" },
};

export function OutcomeReceipt({ outcome }: { outcome: OutcomeSummary }) {
  if (outcome.kind === "none" || outcome.kind === "pending") return null;
  const tone = TONE[outcome.kind] ?? TONE.declined;
  const when = fmtClockTime(outcome.at);

  return (
    <div className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${tone.ring}`}>
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[11px] font-bold ${tone.iconColor}`}
        aria-hidden
      >
        {tone.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg-primary">{outcome.headline}</p>
        <p className="mt-0.5 text-xs text-fg-secondary">
          {outcome.detail}
          {when ? <span className="text-fg-muted"> · by you, {when}</span> : null}
        </p>
        {outcome.kind === "approved" && outcome.automationId ? (
          <Link
            href="/automations"
            className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-gold-300 transition hover:text-gold-200"
          >
            View in Workflows →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
