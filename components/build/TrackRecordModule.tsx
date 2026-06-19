import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { TrackRecord } from "@/lib/supabase/database.types";
import { ModuleHeader, inputClass } from "./DraftWithEarn";
import { createTrackRecord, deleteTrackRecord } from "./actions";
import { updateTrackRecord } from "./edit-actions";
import { TableRecordEditor, EditInput } from "./RecordEditor";

function compactUsd(n: number | null): string | null {
  if (!n || n <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export async function TrackRecordModule() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const supabase = createServerClient();
  const { data } = await supabase
    .from("track_records")
    .select("*")
    .order("vintage_year", { ascending: false });
  const records = (data ?? []) as TrackRecord[];

  return (
    <div>
      <ModuleHeader
        title="Track Record"
        blurb="Prior deals and performance — the proof behind the thesis."
        module="track_record"
      />

      <form action={createTrackRecord} className="mb-6 grid gap-3 rounded-xl border border-line bg-surface-1 p-4 sm:grid-cols-2">
        <input name="deal_name" placeholder="Deal name" className={`${inputClass} sm:col-span-2`} />
        <input name="asset_class" placeholder="Asset class" className={inputClass} />
        <input name="vintage_year" type="number" placeholder="Vintage year" className={inputClass} />
        <input name="invested_amount" type="number" placeholder="Invested ($)" className={inputClass} />
        <input name="realized_value" type="number" placeholder="Realized value ($)" className={inputClass} />
        <input name="gross_irr" type="number" step="0.1" placeholder="Gross IRR (%)" className={inputClass} />
        <input name="gross_moic" type="number" step="0.1" placeholder="Gross MOIC (x)" className={inputClass} />
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <input type="checkbox" name="is_realized" className="h-3.5 w-3.5 accent-gold-500" />
          Realized
        </label>
        <button className="justify-self-start rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 sm:col-span-2">
          Add record
        </button>
      </form>

      {records.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
          No track record yet. Add prior deals — or let Earn assemble them into an investor-ready summary.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left">
                {["Deal", "Class", "Vintage", "Invested", "IRR", "MOIC", ""].map((h) => (
                  <th key={h} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <TableRecordEditor
                  key={r.id}
                  id={r.id}
                  action={updateTrackRecord}
                  colCount={7}
                  actions={
                    <form action={deleteTrackRecord}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="rounded-md border border-line px-1.5 py-0.5 text-xs text-fg-muted transition hover:border-red-500/40 hover:text-red-400">
                        ✕
                      </button>
                    </form>
                  }
                  display={
                    <>
                      <td className="px-3 py-2 text-fg-primary">{r.deal_name}</td>
                      <td className="px-3 py-2">{r.asset_class ?? "—"}</td>
                      <td className="px-3 py-2">{r.vintage_year ?? "—"}</td>
                      <td className="px-3 py-2">{compactUsd(r.invested_amount) ?? "—"}</td>
                      <td className="px-3 py-2">{r.gross_irr != null ? `${r.gross_irr}%` : "—"}</td>
                      <td className="px-3 py-2">{r.gross_moic != null ? `${r.gross_moic}x` : "—"}</td>
                    </>
                  }
                >
                  <EditInput name="deal_name" defaultValue={r.deal_name} placeholder="Deal name" className="sm:col-span-2" />
                  <EditInput name="asset_class" defaultValue={r.asset_class ?? ""} placeholder="Asset class" />
                  <EditInput name="vintage_year" type="number" defaultValue={r.vintage_year ?? ""} placeholder="Vintage year" />
                  <EditInput name="invested_amount" type="number" defaultValue={r.invested_amount ?? ""} placeholder="Invested ($)" />
                  <EditInput name="realized_value" type="number" defaultValue={r.realized_value ?? ""} placeholder="Realized value ($)" />
                  <EditInput name="gross_irr" type="number" step="0.1" defaultValue={r.gross_irr ?? ""} placeholder="Gross IRR (%)" />
                  <EditInput name="gross_moic" type="number" step="0.1" defaultValue={r.gross_moic ?? ""} placeholder="Gross MOIC (x)" />
                  <label className="flex items-center gap-2 text-sm text-fg-secondary">
                    <input type="checkbox" name="is_realized" defaultChecked={r.is_realized} className="h-3.5 w-3.5 accent-gold-500" />
                    Realized
                  </label>
                </TableRecordEditor>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
