"use client";

import { useState } from "react";
import { inputClass } from "./DraftWithEarn";
import { linkStakeholder } from "./stakeholder-link-actions";

export interface StakeholderLite {
  id: string;
  name: string;
  kind: string;
  principal_id: string | null;
  investor_id: string | null;
}
export interface IdentityLite {
  id: string;
  name: string;
}

type LinkType = "none" | "principal" | "investor";

function currentType(s: StakeholderLite): LinkType {
  if (s.principal_id) return "principal";
  if (s.investor_id) return "investor";
  return "none";
}

// One row: shows the stakeholder's current linked identity (or "unlinked") and an
// inline control to link it to a principal or investor. Self-contained form.
function StakeholderRow({
  stakeholder,
  principals,
  investors,
}: {
  stakeholder: StakeholderLite;
  principals: IdentityLite[];
  investors: IdentityLite[];
}) {
  const [type, setType] = useState<LinkType>(currentType(stakeholder));
  const linkedId = stakeholder.principal_id ?? stakeholder.investor_id ?? "";
  const linkedName =
    (stakeholder.principal_id
      ? principals.find((p) => p.id === stakeholder.principal_id)?.name
      : stakeholder.investor_id
        ? investors.find((i) => i.id === stakeholder.investor_id)?.name
        : null) ?? null;

  const options = type === "principal" ? principals : type === "investor" ? investors : [];

  return (
    <form
      action={linkStakeholder}
      className="flex flex-wrap items-center gap-2 border-b border-line/60 bg-surface-1 px-3 py-2 last:border-b-0"
    >
      <input type="hidden" name="stakeholderId" value={stakeholder.id} />

      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="truncate text-fg-primary">{stakeholder.name}</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{stakeholder.kind}</span>
      </span>

      <span className="ml-auto inline-flex items-center gap-1.5">
        {linkedName ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
              stakeholder.principal_id
                ? "border-sky-400/40 text-sky-300"
                : "border-emerald-400/40 text-emerald-300"
            }`}
          >
            {stakeholder.principal_id ? "◆ person" : "● investor"} · {linkedName}
          </span>
        ) : (
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
            unlinked
          </span>
        )}
      </span>

      <select
        name="link_type"
        value={type}
        onChange={(e) => setType(e.target.value as LinkType)}
        className={`${inputClass} w-auto py-1`}
      >
        <option value="none">No link</option>
        <option value="principal">Team member</option>
        <option value="investor">Investor</option>
      </select>

      <select
        name="link_id"
        key={type}
        defaultValue={type !== "none" && currentType(stakeholder) === type ? linkedId : ""}
        disabled={type === "none"}
        className={`${inputClass} w-auto py-1 disabled:opacity-50`}
      >
        <option value="">{type === "none" ? "—" : "Select…"}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>

      <button className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-secondary transition hover:text-fg-primary">
        Save
      </button>
    </form>
  );
}

// Compact list to link cap-table stakeholders to existing identities (team
// members / investors), so the firm cap table and people/LP records share
// identities.
export function StakeholderLinks({
  stakeholders,
  principals,
  investors,
}: {
  stakeholders: StakeholderLite[];
  principals: IdentityLite[];
  investors: IdentityLite[];
}) {
  return (
    <div className="mt-8">
      <h3 className="mb-1 font-display text-lg font-semibold tracking-tight text-fg-primary">
        Stakeholder identities
      </h3>
      <p className="mb-3 text-sm text-fg-secondary">
        Link cap-table stakeholders to team members or investors so people and LP records stay in sync.
      </p>

      <div className="overflow-hidden rounded-xl border border-line">
        {stakeholders.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-fg-muted">
            No stakeholders yet — add holders to the cap table first.
          </div>
        ) : (
          stakeholders.map((s) => (
            <StakeholderRow key={s.id} stakeholder={s} principals={principals} investors={investors} />
          ))
        )}
      </div>
    </div>
  );
}
