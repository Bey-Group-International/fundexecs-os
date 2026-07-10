import Link from "next/link";
import { getUnifiedOwnership } from "@/lib/ownership";
import { compactUsd, usd } from "@/lib/format";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { EmptyState, StatTile } from "@/components/execute/ui";

function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

// Execute › Ownership: the reconciled cap table — every holder exactly once,
// with their LP fund commitments AND their direct equity in the firm's own
// vehicles (GP, SPVs) side by side. The single view Carta keeps split across
// its fund-admin and cap-table products.
export async function ExecuteOwnershipModule({ orgId }: { orgId: string }) {
  const o = await getUnifiedOwnership(orgId);

  const header = (
    <ModuleHeader
      title="Ownership"
      blurb="Every holder, once — fund commitments and direct entity equity reconciled into one ledger."
    />
  );

  if (o.holderCount === 0) {
    return (
      <div>
        {header}
        <EmptyState
          note="No holders yet. Add fund commitments (Cap Table) or entity equity (Build › Entity) and they reconcile here into one ownership ledger."
          href="/build/profile#entity"
          cta="Build › Entity"
        />
      </div>
    );
  }

  return (
    <div>
      {header}

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile value={String(o.holderCount)} label="holders" sub={`${o.linkedCount} in both worlds`} />
        <StatTile value={compactUsd(o.totalCommitted)} label="fund committed" sub={`${o.fundOnly} fund-only`} />
        <StatTile value={compactUsd(o.totalEquityInvested)} label="direct equity" sub={`${o.equityOnly} equity-only`} />
        <StatTile
          value={String(o.linkedCount)}
          label="reconciled"
          tone={o.linkedCount > 0 ? "good" : undefined}
          sub="fund + equity"
        />
      </div>

      {/* Cross-links to the two source views this reconciles */}
      <div className="mb-4 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-wider">
        <Link href="/execute/cap_table" className="rounded-md border border-line px-2.5 py-1 text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300">
          → Fund cap table
        </Link>
        <Link href="/build/profile#entity" className="rounded-md border border-line px-2.5 py-1 text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300">
          → Entity ownership
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/80 text-left">
              {["Holder", "Kind", "Committed", "Called", "Distributed", "Direct equity", "Entities", "Position"].map(
                (h, i) => (
                  <th
                    key={h}
                    className={`whitespace-nowrap px-3 py-3 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-muted ${i >= 2 && i <= 6 ? "text-right" : ""}`}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {o.holders.map((h) => (
              <tr key={h.key} className="border-b border-line/50 bg-surface-1 last:border-0">
                <td className="whitespace-nowrap px-3 py-3 font-medium text-fg-primary">{h.name}</td>
                <td className="whitespace-nowrap px-3 py-3 text-fg-secondary">{humanize(h.kind)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">
                  {h.fund ? usd(h.fund.committed) : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">
                  {h.fund ? usd(h.fund.called) : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">
                  {h.fund ? usd(h.fund.distributed) : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-primary">
                  {h.hasEquity ? usd(h.equityInvested) : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-fg-secondary">
                  {h.hasEquity ? h.equity.map((e) => e.entityName).join(", ") : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                      h.linked
                        ? "border-emerald-400/40 text-emerald-300"
                        : h.hasFund
                          ? "border-gold-500/40 text-gold-300"
                          : "border-status-info/40 text-status-info"
                    }`}
                  >
                    {h.linked ? "Fund + Equity" : h.hasFund ? "Fund" : "Equity"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
