import Link from "next/link";
import { getExecuteClosing, type DealClose } from "@/lib/execute-closing";
import { compactUsd } from "@/lib/format";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { promoteDealToAsset } from "@/components/execute/actions";
import { EmptyState, StatTile } from "@/components/execute/ui";

// Thin readiness meter, tone shifting as the close firms up.
function Meter({ value }: { value: number }) {
  const tone = value >= 100 ? "bg-emerald-400" : value >= 60 ? "bg-gold-400" : "bg-fg-muted";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div className={`h-full rounded-full ${tone} transition-[width]`} style={{ width: `${Math.max(value, 3)}%` }} />
    </div>
  );
}

function CloseCard({ c }: { c: DealClose }) {
  const isClosing = c.deal.stage === "closing";
  const overdue = c.daysToClose != null && c.daysToClose < 0;
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4 transition hover:border-gold-500/30">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-medium text-fg-primary">{c.deal.name}</span>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
            isClosing ? "border-gold-500/40 text-gold-300" : "border-status-info/50 text-status-info"
          }`}
        >
          {isClosing ? "Closing" : "Awaiting IC"}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-fg-muted">
        {c.deal.target_amount ? <span className="text-fg-secondary">{compactUsd(c.deal.target_amount)}</span> : null}
        {c.deal.asset_class ? <span>{c.deal.asset_class}</span> : null}
        {c.fundName ? <span>fund · {c.fundName}</span> : null}
        {c.deal.expected_close ? (
          <span className={overdue ? "text-status-danger" : "text-gold-300"}>
            {overdue ? `overdue ${Math.abs(c.daysToClose!)}d` : `closes ${c.deal.expected_close}${c.daysToClose != null ? ` · ${c.daysToClose}d` : ""}`}
          </span>
        ) : null}
      </div>

      {/* Progress */}
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1">
          <Meter value={c.progress} />
        </div>
        <span className="shrink-0 font-mono text-[10px] text-fg-muted">
          {c.doneCount}/{c.total} steps
        </span>
      </div>

      {/* Checklist */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {c.steps.map((s) => (
          <span
            key={s.key}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              s.done ? "border-emerald-400/40 text-emerald-300" : "border-line text-fg-muted"
            }`}
          >
            {s.done ? "✓" : "○"} {s.label}
          </span>
        ))}
      </div>

      {/* Next step + action */}
      <div className="mt-3 flex items-center justify-between gap-3">
        {c.ready ? (
          <span className="font-mono text-[11px] text-emerald-300">✓ Cleared to close</span>
        ) : (
          <span className="truncate font-mono text-[11px] text-fg-muted">Next · {c.nextStep?.action}</span>
        )}
        {isClosing ? (
          <form action={promoteDealToAsset} className="shrink-0">
            <input type="hidden" name="deal_id" value={c.deal.id} />
            <button
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                c.ready
                  ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
                  : "border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20"
              }`}
            >
              → {c.ready ? "Complete close" : "Promote to portfolio"}
            </button>
          </form>
        ) : (
          <Link
            href="/run/strategy"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-status-info/40 bg-status-info/10 px-3 py-1.5 text-xs font-medium text-status-info transition hover:bg-status-info/20"
          >
            → Take to IC
          </Link>
        )}
      </div>
    </div>
  );
}

// Execute › Closing: the close run as a process. Each deal heading to close
// carries a live checklist of the steps that gate a wire; the final step
// promotes the deal into the portfolio book.
export async function ExecuteClosingModule({ orgId }: { orgId: string }) {
  const summary = await getExecuteClosing(orgId);

  if (summary.closes.length === 0) {
    return (
      <div>
        <ModuleHeader
          title="Closing"
          blurb="The close, run as a process — every step that gates the wire, tracked to done."
        />
        <EmptyState
          note="Nothing in closing. Take a deal through IC in the Run hub and it will appear here as a tracked close."
          href="/run/strategy"
          cta="Run hub"
        />
      </div>
    );
  }

  return (
    <div>
      <ModuleHeader
        title="Closing"
        blurb="The close, run as a process — every step that gates the wire, tracked to done."
      />

      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile value={String(summary.inClosing)} label="in closing" sub={summary.awaitingIc > 0 ? `${summary.awaitingIc} awaiting IC` : undefined} />
        <StatTile value={compactUsd(summary.capitalClosing)} label="capital closing" />
        <StatTile
          value={`${summary.avgReadiness}%`}
          label="avg readiness"
          tone={summary.avgReadiness >= 80 ? "good" : undefined}
        />
        <StatTile
          value={summary.nextClose ? (summary.nextClose.days < 0 ? "overdue" : `${summary.nextClose.days}d`) : "—"}
          label="next close"
          tone={summary.overdue > 0 ? "bad" : undefined}
          sub={summary.nextClose ? summary.nextClose.date : undefined}
        />
      </div>

      {summary.readyCount > 0 ? (
        <div className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-2.5 text-sm text-emerald-300">
          ✓ {summary.readyCount} {summary.readyCount === 1 ? "deal is" : "deals are"} cleared to close — complete the close to move {summary.readyCount === 1 ? "it" : "them"} into the portfolio.
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5">
        {summary.closes.map((c) => (
          <CloseCard key={c.deal.id} c={c} />
        ))}
      </div>
    </div>
  );
}
