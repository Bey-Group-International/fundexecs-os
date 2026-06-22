import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type {
  Entity,
  Stakeholder,
  ShareClass,
  EquityHolding,
  OrganizationMember,
  Principal,
  Investor,
} from "@/lib/supabase/database.types";
import { ModuleHeader, inputClass } from "./DraftWithEarn";
import { createEntity, deleteEntity } from "./actions";
import { updateEntity } from "./edit-actions";
import { RecordEditor, EditInput } from "./RecordEditor";
import { EntityTree } from "./EntityTree";
import { EntityOwnership } from "./EntityOwnership";
import { FormationWizard } from "./FormationWizard";
import { DilutionModeler } from "./DilutionModeler";
import { StakeholderLinks } from "./StakeholderLinks";
import { EntityTabs } from "./EntityTabs";
import { EntityInsights } from "./EntityInsights";
import { computeEntityInsights } from "@/lib/entity-insights";

const ENTITY_TYPES = ["gp", "management_co", "fund", "spv", "holdco", "other"];
const TYPE_LABEL: Record<string, string> = {
  gp: "GP",
  management_co: "Management Co.",
  fund: "Fund",
  spv: "SPV",
  holdco: "Holdco",
  other: "Other",
};

// Section headers for the grouped list, in display order.
const GROUPS: { key: string; label: string }[] = [
  { key: "gp", label: "GP" },
  { key: "management_co", label: "Management Co." },
  { key: "fund", label: "Funds" },
  { key: "spv", label: "SPVs" },
  { key: "holdco", label: "Holdcos" },
  { key: "other", label: "Other" },
];

export async function EntityModule() {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) redirect("/login");
  const supabase = createServerClient();
  // One parallel batch for everything independent (entities, cap-table tables,
  // team members, investors); principals depend on members so follow after.
  const [entitiesRes, stakeholdersRes, classesRes, holdingsRes, membersRes, investorRes] =
    await Promise.all([
      supabase.from("entities").select("*").order("created_at", { ascending: false }),
      supabase.from("stakeholders").select("*").order("name", { ascending: true }),
      supabase.from("share_classes").select("*"),
      supabase.from("equity_holdings").select("*"),
      supabase.from("organization_members").select("*").eq("organization_id", ctx.orgId),
      supabase
        .from("investors")
        .select("id,name")
        .eq("organization_id", ctx.orgId)
        .order("name", { ascending: true }),
    ]);
  const entities = (entitiesRes.data ?? []) as Entity[];
  const stakeholders = (stakeholdersRes.data ?? []) as Stakeholder[];
  const shareClasses = (classesRes.data ?? []) as ShareClass[];
  const holdings = (holdingsRes.data ?? []) as EquityHolding[];
  const members = (membersRes.data ?? []) as OrganizationMember[];
  const investors = (investorRes.data ?? []) as Pick<Investor, "id" | "name">[];

  let principals: Principal[] = [];
  if (members.length) {
    const { data } = await supabase
      .from("principals")
      .select("*")
      .in("id", members.map((m) => m.principal_id));
    principals = (data ?? []) as Principal[];
  }

  const principalOptions = principals.map((p) => ({ id: p.id, name: p.full_name || p.email }));
  const investorOptions = investors.map((i) => ({ id: i.id, name: i.name }));
  const insights = computeEntityInsights(
    entities.map((e) => ({ id: e.id, name: e.name, entity_type: e.entity_type })),
    stakeholders.map((s) => ({ principal_id: s.principal_id, investor_id: s.investor_id })),
    holdings,
  );

  const structure = (
    <>
      {entities.length > 0 ? <EntityTree entities={entities} /> : null}

      <div className="mb-4">
        <FormationWizard parents={entities.map((e) => ({ id: e.id, name: e.name }))} />
      </div>

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
        <select name="parent_entity_id" defaultValue="" className={inputClass}>
          <option value="">— none (parent entity) —</option>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input name="formation_date" type="date" className={inputClass} />
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
        <div className="flex flex-col gap-6">
          {GROUPS.map((group) => {
            const rows = entities.filter((e) => e.entity_type === group.key);
            if (rows.length === 0) return null;
            return (
              <div key={group.key} className="flex flex-col gap-2">
                <div className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{group.label}</div>
                {rows.map((e) => (
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
                            {e.formation_date ? (
                              <span className="font-mono text-[10px] text-fg-muted">· {e.formation_date.slice(0, 4)}</span>
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
                        <select name="parent_entity_id" defaultValue={e.parent_entity_id ?? ""} className={inputClass}>
                          <option value="">— none (parent entity) —</option>
                          {entities
                            .filter((other) => other.id !== e.id)
                            .map((other) => (
                              <option key={other.id} value={other.id}>
                                {other.name}
                              </option>
                            ))}
                        </select>
                        <EditInput name="formation_date" type="date" defaultValue={e.formation_date ?? ""} />
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
            );
          })}
        </div>
      )}

    </>
  );

  const capTable = (
    <EntityOwnership
      entities={entities.map((e) => ({ id: e.id, name: e.name, entity_type: e.entity_type }))}
      stakeholders={stakeholders.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))}
      shareClasses={shareClasses.map((c) => ({ id: c.id, entity_id: c.entity_id, name: c.name }))}
      holdings={holdings}
    />
  );

  const modeling =
    entities.length > 0 ? (
      <DilutionModeler
        entities={entities.map((e) => ({ id: e.id, name: e.name }))}
        holdings={holdings}
        stakeholders={stakeholders.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))}
        shareClasses={shareClasses.map((c) => ({ id: c.id, name: c.name }))}
      />
    ) : (
      <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
        Add an entity and its cap table to model rounds and dilution.
      </p>
    );

  const people = (
    <StakeholderLinks
      stakeholders={stakeholders.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        principal_id: s.principal_id,
        investor_id: s.investor_id,
      }))}
      principals={principalOptions}
      investors={investorOptions}
    />
  );

  return (
    <div>
      <ModuleHeader
        title="Entity"
        blurb="Your legal structure and ownership — GP, management company, funds, SPVs."
        module="entity"
      />
      <EntityTabs
        overview={<EntityInsights insights={insights} />}
        tabs={[
          { key: "structure", label: "Structure", content: structure },
          { key: "cap_table", label: "Cap Table", content: capTable },
          { key: "modeling", label: "Modeling", content: modeling },
          { key: "people", label: "People", content: people },
        ]}
      />
    </div>
  );
}
