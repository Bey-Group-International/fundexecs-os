"use client";

// components/source/PartnersLive.tsx
// Client component — renders partner pipeline with per-row inline contact editing.
import { useState } from "react";
import { DeletePartnerBtn, ClearPartnersBtn } from "@/components/source/SourceDeleteControls";
import { InlineContactEdit, EditContactBtn } from "@/components/source/InlineContactEdit";
import type { ContactFields } from "@/app/(app)/[hub]/[module]/actions";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  prospect: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  inactive: "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200",
};

interface PartnerRow {
  id: string;
  name: string | null;
  partner_type: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone?: string | null;
  role?: string | null;
  website?: string | null;
  url_source?: string | null;
  provenance?: string | null;
  status: string | null;
  notes: string | null;
}

function PartnerRowItem({ p, isLast }: { p: PartnerRow; isLast: boolean }) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<ContactFields>({
    contact_name: p.contact_name,
    contact_email: p.contact_email,
    contact_phone: p.contact_phone,
    role: p.role,
    website: p.website,
    url_source: p.url_source,
  });

  return (
    <>
      <tr className={isLast ? "" : "border-b border-line"}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-fg">{p.name}</span>
            {p.provenance === "ai" ? (
              <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-gold-300">AI Sourced</span>
            ) : (
              <span className="rounded-full border border-line px-1.5 py-0 font-mono text-[8px] uppercase tracking-wider text-fg-muted">Manual</span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-fg-muted">{p.partner_type ?? "—"}</td>
        <td className="px-4 py-3">
          {fields.contact_name ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-fg">
                {fields.contact_name}
                {fields.role && (
                  <span className="ml-1 font-normal text-fg-muted">· {fields.role}</span>
                )}
              </span>
              {fields.contact_email && (
                <a
                  href={`mailto:${fields.contact_email}`}
                  className="font-mono text-[10px] text-accent underline-offset-2 hover:underline"
                >
                  {fields.contact_email}
                </a>
              )}
              {fields.contact_phone && (
                <span className="font-mono text-[10px] text-fg-muted">{fields.contact_phone}</span>
              )}
            </div>
          ) : (
            <span className="text-fg-muted">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
              STATUS_STYLES[p.status ?? ""] ?? "bg-neutral-100 text-neutral-500"
            }`}
          >
            {p.status ?? "unknown"}
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-fg-muted">
          {fields.website ? (
            <a
              href={fields.website.startsWith("http") ? fields.website : `https://${fields.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] text-fg-muted hover:text-gold-300 hover:underline"
            >
              {fields.website.replace(/^https?:\/\//, "")}
            </a>
          ) : (
            "—"
          )}
        </td>
        <td className="max-w-[260px] truncate px-4 py-3 text-xs text-fg-muted">
          {p.notes ?? "—"}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <EditContactBtn onClick={() => setEditing((v) => !v)} />
            <DeletePartnerBtn id={p.id} />
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={7} className="px-4 pb-3">
            <InlineContactEdit
              table="partners"
              id={p.id}
              initial={fields}
              onClose={() => setEditing(false)}
              onSaved={(saved) => {
                setFields(saved);
                setEditing(false);
              }}
            />
          </td>
        </tr>
      )}
    </>
  );
}

interface Props {
  partners: PartnerRow[];
}

export function PartnersTable({ partners }: Props) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          Partner Pipeline
        </p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-fg-muted">
            {partners.length} partner{partners.length !== 1 ? "s" : ""}
          </span>
          {partners.length > 0 && <ClearPartnersBtn />}
        </div>
      </div>

      {partners.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
          <p className="text-sm text-fg-muted">No partners yet.</p>
          <p className="mt-1 text-xs text-fg-muted/60">
            Use &ldquo;Source targets&rdquo; to let Earn propose co-GPs, advisors, and service
            providers.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-subtle">
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Partner
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Type
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Contact
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Website
                </th>
                <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
                  Notes
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {partners.map((p, i) => (
                <PartnerRowItem key={p.id} p={p} isLast={i === partners.length - 1} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
