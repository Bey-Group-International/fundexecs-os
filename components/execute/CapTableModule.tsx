import { getCapTable } from "@/lib/cap-table";
import { compactUsd, usd, multiple } from "@/lib/format";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { EmptyState, StatTile, EarnAction } from "@/components/execute/ui";

function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

// Execute › Cap Table: the ownership ledger across every stakeholder, doubling
// as each holder's capital account (committed, called, unfunded, distributed,
// NAV, DPI/TVPI). The agent team works it in place — IR drafts LP statements,
// Ops reconciles the accounts.
export async function ExecuteCapTableModule({ orgId }: { orgId: string }) {
  const t = await getCapTable(orgId);

  const header = (
    <ModuleHeader
      title="Cap Table"
      blurb="Who owns what across your funds — every stakeholder's capital account, live."
    />
  );

  if (t.holderCount === 0) {
    return (
      <div>
        {header}
        <EmptyState
          note="No commitments on the books yet. Add investors and their commitments — LPs, co-GPs, and institutions — and the cap table assembles here."
          href="/source/lp_pipeline"
          cta="LP pipeline"
        />
      </div>
    );
  }

  return (
    <div>
      {header}

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile value={compactUsd(t.totalCommitted)} label="committed" sub={`${t.holderCount} holders · ${t.fundCount} ${t.fundCount === 1 ? "fund" : "funds"}`} />
        <StatTile value={compactUsd(t.totalCalled)} label="called" sub={t.calledPct != null ? `${t.calledPct}% of commitments` : undefined} />
        <StatTile value={compactUsd(t.totalUnfunded)} label="unfunded" />
        <StatTile value={compactUsd(t.totalNav)} label="NAV" sub={`top holder ${t.topHolderPct}%`} />
      </div>

      {/* Agent actions */}
      <div className="mb-4 flex flex-wrap gap-2">
        <EarnAction kind="cap_statements" label="Draft LP statements" />
        <EarnAction kind="cap_reconcile" label="Reconcile accounts" subtle />
      </div>

      {/* Stakeholder-type breakdown — not just LPs */}
      {t.byType.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {t.byType.map((b) => (
            <span
              key={b.type}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface-1 px-2.5 py-1 text-xs text-fg-secondary"
            >
              <span className="font-mono text-[10px] text-fg-muted">{b.count}</span>
              {humanize(b.type)}
              <span className="font-mono text-[11px] text-fg-primary">{b.pct}%</span>
            </span>
          ))}
        </div>
      ) : null}

      {/* Cap table / capital accounts */}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/80 text-left">
              {["Holder", "Type", "Committed", "Own %", "Called", "Unfunded", "Distributed", "NAV", "DPI", "TVPI"].map(
                (h, i) => (
                  <th
                    key={h}
                    className={`whitespace-nowrap px-3 py-3 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-muted ${i >= 2 ? "text-right" : ""}`}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {t.holders.map((h) => (
              <tr key={h.investorId} className="border-b border-line/50 bg-surface-1 last:border-0">
                <td className="whitespace-nowrap px-3 py-3 font-medium text-fg-primary">{h.name}</td>
                <td className="whitespace-nowrap px-3 py-3 text-fg-secondary">{humanize(h.type)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-primary">{usd(h.committed)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-gold-300">{h.ownershipPct}%</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">{usd(h.called)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">{usd(h.unfunded)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">{usd(h.distributed)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-primary">{usd(h.navShare)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">{multiple(h.dpi)}</td>
                <td
                  className={`whitespace-nowrap px-3 py-3 text-right font-mono ${
                    h.tvpi == null ? "text-fg-muted" : h.tvpi >= 1 ? "text-emerald-300" : "text-status-danger"
                  }`}
                >
                  {multiple(h.tvpi)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
