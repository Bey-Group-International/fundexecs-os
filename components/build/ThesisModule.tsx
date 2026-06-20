import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { InvestmentThesis } from "@/lib/supabase/database.types";
import { ModuleHeader, inputClass } from "./DraftWithEarn";
import { deleteThesis } from "./actions";
import { updateThesis, setActiveThesis } from "./edit-actions";
import { RecordEditor, EditInput } from "./RecordEditor";
import { ThesisForm } from "./ThesisForm";
import { ThesisFit } from "./ThesisFit";

// Small read-only tag chip for the card display.
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-fg-secondary">
      {children}
    </span>
  );
}

export async function ThesisModule() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const supabase = createServerClient();
  const { data } = await supabase
    .from("investment_theses")
    .select("*")
    .order("created_at", { ascending: false });
  const theses = (data ?? []) as InvestmentThesis[];

  // The thesis fit preview runs against the active thesis, or the most recent.
  const previewThesis = theses.find((t) => t.is_active) ?? theses[0] ?? null;

  return (
    <div>
      <ModuleHeader
        title="Investment Thesis"
        blurb="What you invest in, where, and the returns you target."
        module="thesis"
      />

      <ThesisForm />

      <ThesisFit thesis={previewThesis} />

      {theses.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
          No thesis yet. Add one above, or let Earn draft it.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {theses.map((t) => {
            const targets = [
              t.check_size_min != null || t.check_size_max != null
                ? `$${(t.check_size_min ?? 0).toLocaleString()}–${
                    t.check_size_max != null ? t.check_size_max.toLocaleString() : "∞"
                  }`
                : null,
              t.target_irr != null ? `${t.target_irr}% IRR` : null,
              t.target_moic != null ? `${t.target_moic}x MOIC` : null,
            ].filter(Boolean) as string[];

            return (
              <div key={t.id} className="rounded-xl border border-line bg-surface-1 p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <RecordEditor
                      id={t.id}
                      action={updateThesis}
                      layout="grid"
                      display={
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-fg-primary">{t.title}</span>
                            {t.is_active ? (
                              <span className="rounded-full border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-success">
                                Active
                              </span>
                            ) : (
                              <form action={setActiveThesis}>
                                <input type="hidden" name="id" value={t.id} />
                                <button className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-300">
                                  Set active
                                </button>
                              </form>
                            )}
                          </div>
                          {t.summary ? (
                            <p className="mt-1 text-xs leading-snug text-fg-secondary">{t.summary}</p>
                          ) : null}

                          {(t.asset_classes?.length || t.geographies?.length) ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {t.asset_classes?.map((a) => <Chip key={`a-${a}`}>{a}</Chip>)}
                              {t.geographies?.map((g) => (
                                <Chip key={`g-${g}`}>📍 {g}</Chip>
                              ))}
                            </div>
                          ) : null}

                          {targets.length ? (
                            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                              {targets.join(" · ")}
                            </p>
                          ) : null}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
