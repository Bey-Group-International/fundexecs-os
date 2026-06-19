import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { Entity } from "@/lib/supabase/database.types";
import { ModuleHeader, inputClass } from "./DraftWithEarn";
import { createEntity, deleteEntity } from "./actions";
import { updateEntity } from "./edit-actions";
import { RecordEditor, EditInput } from "./RecordEditor";

const ENTITY_TYPES = ["gp", "management_co", "fund", "spv", "holdco", "other"];
const TYPE_LABEL: Record<string, string> = {
  gp: "GP",
  management_co: "Management Co.",
  fund: "Fund",
  spv: "SPV",
  holdco: "Holdco",
  other: "Other",
};

export async function EntityModule() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const supabase = createServerClient();
  const { data } = await supabase.from("entities").select("*").order("created_at", { ascending: false });
  const entities = (data ?? []) as Entity[];

  return (
    <div>
      <ModuleHeader
        title="Entity"
        blurb="Your legal structure — GP, management company, funds, SPVs."
        module="entity"
      />

      <form action={createEntity} className="mb-6 grid gap-3 rounded-xl border border-line bg-surface-1 p-4 sm:grid-cols-2">
        <input name="name" placeholder="Entity name" className={`${inputClass} sm:col-span-2`} />
        <select name="entity_type" defaultValue="spv" className={inputClass}>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <input name="jurisdiction" placeholder="Jurisdiction (e.g. Delaware)" className={inputClass} />
        <input name="notes" placeholder="Notes" className={`${inputClass} sm:col-span-2`} />
        <button className="justify-self-start rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 sm:col-span-2">
          Add entity
        </button>
      </form>

      {entities.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
          No entities yet. Add your GP, funds, and SPVs — or let Earn propose a structure.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {entities.map((e) => (
            <div key={e.id} className="flex items-start gap-3 rounded-xl border border-line bg-surface-1 p-3">
              <div className="min-w-0 flex-1">
                <RecordEditor
                  id={e.id}
                  action={updateEntity}
                  layout="grid"
                  display={
                    <div className="flex items-center gap-3">
                      <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
                        {TYPE_LABEL[e.entity_type] ?? e.entity_type}
                      </span>
                      <span className="text-sm text-fg-primary">{e.name}</span>
                      {e.jurisdiction ? (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{e.jurisdiction}</span>
                      ) : null}
                    </div>
                  }
                >
                  <EditInput name="name" defaultValue={e.name} placeholder="Entity name" className="sm:col-span-2" />
                  <select name="entity_type" defaultValue={e.entity_type} className={inputClass}>
                    {ENTITY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  <EditInput name="jurisdiction" defaultValue={e.jurisdiction ?? ""} placeholder="Jurisdiction (e.g. Delaware)" />
                  <EditInput name="notes" defaultValue={e.notes ?? ""} placeholder="Notes" className="sm:col-span-2" />
                </RecordEditor>
              </div>
              <form action={deleteEntity}>
                <input type="hidden" name="id" value={e.id} />
                <button className="rounded-md border border-line px-2 py-1 text-xs text-fg-muted transition hover:border-red-500/40 hover:text-red-400">
                  ✕
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
