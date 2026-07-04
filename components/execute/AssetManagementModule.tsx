import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { isExited } from "@/lib/execute-performance";
import { compactUsd, usd, multiple, num, shortDate } from "@/lib/format";
import { ModuleHeader } from "@/components/build/DraftWithEarn";
import { EmptyState, StatTile } from "@/components/execute/ui";
import AddRowForm from "@/components/AddRowForm";
import { ADD_ROW_CONFIGS } from "@/lib/module-forms";
import { RecordLifecycleActions } from "@/components/RecordLifecycleActions";
import type { Asset } from "@/lib/supabase/database.types";

function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

function markMultiple(a: Asset): number | null {
  const c = num(a.acquisition_cost);
  const v = num(a.current_value);
  return c > 0 && v > 0 ? Math.round((v / c) * 100) / 100 : null;
}

// Execute › Asset Management: the held book with real marks. A portfolio
// dashboard (NAV, cost, unrealized gain, gross MOIC) and a by-type breakdown
// over a marks table — plus a full add-form so cost, value, NOI, and cap rate
// are entered in-app rather than only through Earn.
export async function ExecuteAssetManagementModule({
  orgId,
  sessionId,
}: {
  orgId: string;
  sessionId?: string;
}) {
  const supabase = await createServerClient();
  let query = supabase
    .from("assets")
    .select("*")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("current_value", { ascending: false, nullsFirst: false });
  // Asset Management is session-scoped: inside a session frame, show only this
  // session's holdings; standalone, the full org-wide book.
  if (sessionId) query = query.eq("session_id", sessionId);
  const { data } = await query;
  const assets = (data ?? []) as Asset[];

  const fields = ADD_ROW_CONFIGS["execute/asset_management"]?.fields ?? [];

  const header = (
    <ModuleHeader title="Asset Management" blurb="Portfolio holdings and their current marks — value, cost, and yield." />
  );

  if (assets.length === 0) {
    return (
      <div>
        {header}
        <AddRowForm hub="execute" module="asset_management" fields={fields} sessionId={sessionId} />
        <EmptyState
          note="No portfolio assets yet. Add a holding above with its cost and current value, and your NAV will build here."
          href="/workspace"
          cta="Open Earn"
        />
      </div>
    );
  }

  const held = assets.filter((a) => !isExited(a.status));
  const nav = held.reduce((s, a) => s + num(a.current_value), 0);
  const cost = held.reduce((s, a) => s + num(a.acquisition_cost), 0);
  const gain = nav - cost;
  const grossMoic = cost > 0 ? Math.round((nav / cost) * 100) / 100 : null;

  // By-type breakdown over held assets — value share of the book.
  const typeMap = new Map<string, { count: number; value: number }>();
  for (const a of held) {
    const t = typeMap.get(a.asset_type) ?? { count: 0, value: 0 };
    t.count += 1;
    t.value += num(a.current_value);
    typeMap.set(a.asset_type, t);
  }
  const byType = [...typeMap.entries()].sort((a, b) => b[1].value - a[1].value);

  return (
    <div>
      {header}
      <AddRowForm hub="execute" module="asset_management" fields={fields} sessionId={sessionId} />

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile value={compactUsd(nav)} label="NAV" sub={`${held.length} held`} />
        <StatTile value={compactUsd(cost)} label="cost basis" />
        <StatTile
          value={`${gain >= 0 ? "+" : "−"}${compactUsd(Math.abs(gain))}`}
          label="unrealized gain"
          tone={gain >= 0 ? "good" : "bad"}
        />
        <StatTile
          value={multiple(grossMoic)}
          label="gross MOIC"
          tone={grossMoic == null ? undefined : grossMoic >= 1 ? "good" : "bad"}
        />
      </div>

      {/* By-type breakdown */}
      {byType.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {byType.map(([type, t]) => (
            <span
              key={type}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface-1 px-2.5 py-1 text-xs text-fg-secondary"
            >
              <span className="font-mono text-[10px] text-fg-muted">{t.count}</span>
              {humanize(type)}
              <span className="font-mono text-[11px] text-fg-primary">{compactUsd(t.value)}</span>
            </span>
          ))}
        </div>
      ) : null}

      {/* Marks table */}
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/80 text-left">
              {["Asset", "Type", "Cost", "Value", "Mark", "Status", ""].map((h, i) => (
                <th
                  key={h || "actions"}
                  className={`px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-muted ${i >= 2 && i <= 4 ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => {
              const m = markMultiple(a);
              const exited = isExited(a.status);
              return (
                <tr
                  key={a.id}
                  className={`border-b border-line/50 last:border-0 ${exited ? "opacity-55" : "bg-surface-1"}`}
                >
                  <td className="px-4 py-3 font-medium text-fg-primary">
                    <Link href={`/asset/${a.id}`} className="transition hover:text-gold-300">
                      {a.name}
                    </Link>
                    {a.acquisition_date ? (
                      <span className="ml-2 font-mono text-[10px] text-fg-muted">acq. {shortDate(a.acquisition_date)}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-fg-secondary">{humanize(a.asset_type)}</td>
                  <td className="px-4 py-3 text-right font-mono text-fg-secondary">
                    {a.acquisition_cost ? usd(a.acquisition_cost) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-fg-primary">
                    {a.current_value ? usd(a.current_value) : "—"}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      m == null ? "text-fg-muted" : m >= 1 ? "text-emerald-300" : "text-status-danger"
                    }`}
                  >
                    {multiple(m)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                        exited ? "border-emerald-400/40 text-emerald-300" : "border-line text-fg-muted"
                      }`}
                    >
                      {humanize(a.status ?? "active")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <RecordLifecycleActions
                      hub="execute"
                      module="asset_management"
                      table="assets"
                      id={a.id}
                      className="justify-end"
                      deleteClassName=""
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
