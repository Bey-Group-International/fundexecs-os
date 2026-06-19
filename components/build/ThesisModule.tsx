import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { InvestmentThesis } from "@/lib/supabase/database.types";
import { ModuleHeader, inputClass } from "./DraftWithEarn";
import { createThesis, deleteThesis } from "./actions";
import { updateThesis } from "./edit-actions";
import { RecordEditor, EditInput } from "./RecordEditor";

export async function ThesisModule() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const supabase = createServerClient();
  const { data } = await supabase
    .from("investment_theses")
    .select("*")
    .order("created_at", { ascending: false });
  const theses = (data ?? []) as InvestmentThesis[];

  return (
    <div>
      <ModuleHeader
        title="Investment Thesis"
        blurb="What you invest in, where, and the returns you target."
        module="thesis"
      />

      <form
        action={createThesis}
        className="mb-6 grid gap-3 rounded-xl border border-line bg-surface-1 p-4 sm:grid-cols-2"
      >
        <input name="title" placeholder="Thesis title" className={`${inputClass} sm:col-span-2`} />
        <textarea
          name="summary"
          rows={2}
          placeholder="One-paragraph summary"
          className={`${inputClass} resize-none sm:col-span-2`}
        />
        <input name="asset_classes" placeholder="Asset classes (comma-separated)" className={inputClass} />
        <input name="geographies" placeholder="Geographies (comma-separated)" className={inputClass} />
        <input name="check_size_min" type="number" placeholder="Check size min ($)" className={inputClass} />
        <input name="check_size_max" type="number" placeholder="Check size max ($)" className={inputClass} />
        <input name="target_irr" type="number" step="0.1" placeholder="Target IRR (%)" className={inputClass} />
        <input name="target_moic" type="number" step="0.1" placeholder="Target MOIC (x)" className={inputClass} />
        <button className="justify-self-start rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 sm:col-span-2">
          Add thesis
        </button>
      </form>

      {theses.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
          No thesis yet. Add one above, or let Earn draft it.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {theses.map((t) => (
            <div key={t.id} className="rounded-xl border border-line bg-surface-1 p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <RecordEditor
                    id={t.id}
                    action={updateThesis}
                    layout="grid"
                    display={
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-fg-primary">{t.title}</span>
                          {t.is_active ? (
                            <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
                              Active
                            </span>
                          ) : null}
                        </div>
                        {t.summary ? (
                          <p className="mt-1 text-xs leading-snug text-fg-secondary">{t.summary}</p>
                        ) : null}
                        <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                          {[
                            t.asset_classes?.join(", "),
                            t.geographies?.join(", "),
                            t.target_irr ? `${t.target_irr}% IRR` : null,
                            t.target_moic ? `${t.target_moic}x MOIC` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </p>
                      </div>
                    }
                  >
                    <EditInput name="title" defaultValue={t.title} placeholder="Thesis title" className="sm:col-span-2" />
                    <textarea
                      name="summary"
                      rows={2}
                      defaultValue={t.summary ?? ""}
                      placeholder="One-paragraph summary"
                      className={`${inputClass} resize-none sm:col-span-2`}
                    />
                    <EditInput name="asset_classes" defaultValue={t.asset_classes?.join(", ") ?? ""} placeholder="Asset classes (comma-separated)" />
                    <EditInput name="geographies" defaultValue={t.geographies?.join(", ") ?? ""} placeholder="Geographies (comma-separated)" />
                    <EditInput name="check_size_min" type="number" defaultValue={t.check_size_min ?? ""} placeholder="Check size min ($)" />
                    <EditInput name="check_size_max" type="number" defaultValue={t.check_size_max ?? ""} placeholder="Check size max ($)" />
                    <EditInput name="target_irr" type="number" step="0.1" defaultValue={t.target_irr ?? ""} placeholder="Target IRR (%)" />
                    <EditInput name="target_moic" type="number" step="0.1" defaultValue={t.target_moic ?? ""} placeholder="Target MOIC (x)" />
                  </RecordEditor>
                </div>
                <form action={deleteThesis}>
                  <input type="hidden" name="id" value={t.id} />
                  <button className="rounded-md border border-line px-2 py-1 text-xs text-fg-muted transition hover:border-red-500/40 hover:text-red-400">
                    ✕
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
