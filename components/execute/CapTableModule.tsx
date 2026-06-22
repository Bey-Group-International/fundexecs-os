import Link from "next/link";
import { getCapTable } from "@/lib/cap-table";
import { getUnifiedOwnership, type UnifiedHolder } from "@/lib/ownership";
import { compactUsd, usd, multiple } from "@/lib/format";
import { createServerClient } from "@/lib/supabase/server";
import { summarizePortalViews } from "@/lib/investor-portal";
import { shortDate } from "@/lib/format";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { EmptyState, StatTile, EarnAction } from "@/components/execute/ui";
import { createInvestorPortalShare, revokeInvestorPortalShare } from "@/components/execute/actions";
import CopyLink from "@/components/execute/CopyLink";

function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

// Execute › Cap Table: the ownership ledger across every stakeholder, doubling
// as each holder's capital account (committed, called, unfunded, distributed,
// NAV, DPI/TVPI). The agent team works it in place — IR drafts LP statements,
// Ops reconciles the accounts.
export async function ExecuteCapTableModule({ orgId }: { orgId: string }) {
  const [t, ownership] = await Promise.all([getCapTable(orgId), getUnifiedOwnership(orgId)]);

  // Cross-link to the firm's entity cap table (Build): which fund holders also
  // hold direct equity in the firm's own vehicles (GP, SPVs). Keyed by investor.
  const equityByInvestor = new Map<string, UnifiedHolder>();
  for (const h of ownership.holders) {
    if (h.investorId && h.hasEquity) equityByInvestor.set(h.investorId, h);
  }

  // Live portal links per holder, for the shareable read-only statements, with
  // an engagement signal (has the LP opened it, and when).
  const supabase = createServerClient();
  const { data: shareRows } = await supabase
    .from("investor_portal_shares")
    .select("id, investor_id, token")
    .eq("organization_id", orgId)
    .is("revoked_at", null);
  const shares = (shareRows ?? []) as { id: string; investor_id: string; token: string }[];
  const shareByInvestor = new Map<string, { id: string; token: string }>();
  for (const s of shares) {
    if (!shareByInvestor.has(s.investor_id)) shareByInvestor.set(s.investor_id, { id: s.id, token: s.token });
  }

  let engagement = new Map<string, { count: number; last: string | null }>();
  if (shares.length > 0) {
    const { data: viewRows } = await supabase
      .from("investor_portal_views")
      .select("share_id, created_at")
      .eq("organization_id", orgId)
      .in("share_id", shares.map((s) => s.id));
    engagement = summarizePortalViews((viewRows ?? []) as { share_id: string | null; created_at: string }[]);
  }

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

      {/* Complete ownership — the reconciliation of fund commitments with the
          firm's entity cap table. A view Carta keeps in two separate products. */}
      {ownership.linkedCount > 0 ? (
        <div className="mb-4 rounded-xl border border-gold-500/30 bg-gold-500/5 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
              Complete ownership
            </span>
            <span className="font-mono text-[11px] text-fg-muted">
              {compactUsd(ownership.totalEquityInvested)} direct equity
            </span>
          </div>
          <p className="mt-1 text-sm text-fg-secondary">
            <span className="text-fg-primary">{ownership.linkedCount}</span> of {ownership.holderCount}{" "}
            {ownership.holderCount === 1 ? "holder" : "holders"} also hold direct equity in your vehicles —
            their fund commitments and entity stakes, reconciled into one position.
          </p>
          <Link
            href="/execute/ownership"
            className="mt-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-gold-300 transition hover:text-gold-200"
          >
            → View unified ownership
          </Link>
        </div>
      ) : null}

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
              {["Holder", "Type", "Committed", "Own %", "Called", "Unfunded", "Distributed", "NAV", "DPI", "TVPI", "Portal"].map(
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
                <td className="whitespace-nowrap px-3 py-3 font-medium text-fg-primary">
                  {h.name}
                  {(() => {
                    const eq = equityByInvestor.get(h.investorId);
                    if (!eq) return null;
                    return (
                      <span
                        title={eq.equity.map((e) => e.entityName).join(", ")}
                        className="ml-2 rounded-full border border-gold-500/40 bg-gold-500/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300"
                      >
                        + equity ×{eq.equity.length}
                      </span>
                    );
                  })()}
                </td>
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
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  {(() => {
                    const share = shareByInvestor.get(h.investorId);
                    if (!share) {
                      return (
                        <form action={createInvestorPortalShare} className="inline">
                          <input type="hidden" name="investor_id" value={h.investorId} />
                          <button className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300">
                            + Create link
                          </button>
                        </form>
                      );
                    }
                    const eng = engagement.get(share.id);
                    return (
                      <div className="flex items-center justify-end gap-2">
                        <span className="font-mono text-[10px] text-fg-muted">
                          {eng ? `opened ${eng.count}× · ${shortDate(eng.last)}` : "unopened"}
                        </span>
                        <CopyLink path={`/portal/${share.token}`} />
                        <form action={revokeInvestorPortalShare} className="inline">
                          <input type="hidden" name="id" value={share.id} />
                          <button
                            title="Revoke link"
                            className="inline-flex items-center rounded-md border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:border-status-danger/50 hover:text-status-danger"
                          >
                            Revoke
                          </button>
                        </form>
                      </div>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
