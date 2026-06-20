import { getExecuteCapital, type LedgerRow, type FlowDirection } from "@/lib/execute-capital";
import { usd, compactUsd, shortDate } from "@/lib/format";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { EmptyState, StatTile } from "@/components/execute/ui";
import AddRowForm from "@/components/AddRowForm";
import { ADD_ROW_CONFIGS } from "@/lib/module-forms";

function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

const DIR_TONE: Record<FlowDirection, string> = {
  out: "border-emerald-400/40 text-emerald-300",
  in: "border-gold-500/40 text-gold-300",
  cost: "border-line text-fg-muted",
};

function LedgerLine({ row, first }: { row: LedgerRow; first: boolean }) {
  const { event, direction, signed, runningNet, fundName } = row;
  const amountTone = direction === "out" ? "text-emerald-300" : direction === "in" ? "text-fg-primary" : "text-fg-muted";
  const sign = signed > 0 ? "+" : signed < 0 ? "−" : "";
  return (
    <div className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 bg-surface-1 sm:grid-cols-[7rem_1fr_auto_auto] ${first ? "" : "border-t border-line/50"}`}>
      <span className="font-mono text-[11px] text-fg-muted">{shortDate(event.effective_date)}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${DIR_TONE[direction]}`}>
            {humanize(event.event_type)}
          </span>
          {fundName ? <span className="truncate text-[11px] text-fg-secondary">{fundName}</span> : null}
        </div>
        {event.reference ? (
          <span className="mt-0.5 block truncate font-mono text-[10px] text-fg-muted">{event.reference}</span>
        ) : null}
      </div>
      <span className={`text-right font-mono text-sm ${amountTone}`}>
        {sign}
        {usd(Math.abs(row.event.amount ?? 0))}
      </span>
      <span className="hidden text-right font-mono text-[11px] text-fg-muted sm:block">
        net {runningNet >= 0 ? "" : "−"}
        {usd(Math.abs(runningNet))}
      </span>
    </div>
  );
}

// Execute › Capital Events: the fund cash ledger. A position dashboard
// (paid-in vs returned, net to LPs), a per-type breakdown, and a chronological
// ledger with a running net — plus inline entry for new calls and distributions.
export async function ExecuteCapitalEventsModule({ orgId }: { orgId: string }) {
  const summary = await getExecuteCapital(orgId);
  const fields = ADD_ROW_CONFIGS["execute/capital_events"]?.fields ?? [];

  const header = (
    <ModuleHeader
      title="Capital Events"
      blurb="Calls, distributions, and every flow of capital post-close — with your live net position."
    />
  );

  if (summary.count === 0) {
    return (
      <div>
        {header}
        <AddRowForm hub="execute" module="capital_events" fields={fields} />
        <EmptyState
          note="No capital events yet. Log a capital call or distribution above, or ask Earn — your net position will build here."
          href="/workspace"
          cta="Open Earn"
        />
      </div>
    );
  }

  // Most-recent-first for display; running net is already chronological.
  const rows = [...summary.ledger].reverse();

  return (
    <div>
      {header}
      <AddRowForm hub="execute" module="capital_events" fields={fields} />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile value={compactUsd(summary.called)} label="paid in" />
        <StatTile value={compactUsd(summary.distributed)} label="returned" tone="good" />
        <StatTile
          value={`${summary.net >= 0 ? "+" : "−"}${compactUsd(Math.abs(summary.net))}`}
          label="net to LPs"
          tone={summary.net >= 0 ? "good" : "bad"}
        />
        <StatTile
          value={String(summary.count)}
          label={summary.count === 1 ? "event" : "events"}
          sub={summary.lastActivity ? `latest ${shortDate(summary.lastActivity)}` : undefined}
        />
      </div>

      {/* Upcoming call */}
      {summary.upcoming ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-gold-500/30 bg-gold-500/5 px-4 py-2.5 text-sm text-gold-200">
          <span className="font-mono text-xs text-gold-400">↑ DUE</span>
          <span>
            Capital call of <span className="font-medium">{usd(summary.upcoming.amount)}</span>
            {summary.upcoming.fundName ? ` · ${summary.upcoming.fundName}` : ""} on {shortDate(summary.upcoming.date)}
          </span>
        </div>
      ) : null}

      {/* By-type breakdown */}
      {summary.byType.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {summary.byType.map((t) => (
            <span
              key={t.type}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface-1 px-2.5 py-1 text-xs text-fg-secondary"
            >
              <span className="font-mono text-[10px] text-fg-muted">{t.count}</span>
              {humanize(t.type)}
              <span className="font-mono text-[11px] text-fg-primary">{compactUsd(t.total)}</span>
            </span>
          ))}
        </div>
      ) : null}

      {/* Ledger */}
      <div className="overflow-hidden rounded-xl border border-line">
        {rows.map((r, i) => (
          <LedgerLine key={r.event.id} row={r} first={i === 0} />
        ))}
      </div>
    </div>
  );
}
