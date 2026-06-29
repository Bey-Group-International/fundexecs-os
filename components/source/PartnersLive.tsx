// components/source/PartnersLive.tsx
// Async server component — renders the active partner pipeline for this org.
// Best-effort: any auth/DB failure degrades to an empty state, never a crash.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { DeletePartnerBtn, ClearPartnersBtn } from "@/components/source/SourceDeleteControls";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  prospect: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  inactive: "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200",
};

async function loadPartners() {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return [];
    const supabase = createServerClient();
    const { data } = await supabase
      .from("partners")
      .select(
        "id, name, partner_type, contact_name, contact_email, contact_phone, role, website, url_source, status, notes",
      )
      .eq("organization_id", auth.ctx.orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  } catch {
    return [];
  }
}

export async function PartnersLive() {
  const partners = await loadPartners();

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
            Use &ldquo;Source targets&rdquo; to let Earn propose co-GPs,
            advisors, and service providers.
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
                <tr
                  key={p.id}
                  className={
                    i < partners.length - 1 ? "border-b border-line" : ""
                  }
                >
                  <td className="px-4 py-3 font-medium text-fg">{p.name}</td>
                  <td className="px-4 py-3 text-fg-muted">
                    {p.partner_type ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {p.contact_name ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-fg text-xs font-medium">
                          {p.contact_name}
                          {(p as { role?: string | null }).role && (
                            <span className="ml-1 text-fg-muted font-normal">· {(p as { role?: string | null }).role}</span>
                          )}
                        </span>
                        {p.contact_email && (
                          <a
                            href={`mailto:${p.contact_email}`}
                            className="font-mono text-[10px] text-accent underline-offset-2 hover:underline"
                          >
                            {p.contact_email}
                          </a>
                        )}
                        {(p as { contact_phone?: string | null }).contact_phone && (
                          <span className="font-mono text-[10px] text-fg-muted">{(p as { contact_phone?: string | null }).contact_phone}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
                        STATUS_STYLES[p.status ?? ""] ??
                        "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {p.status ?? "unknown"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-fg-muted">
                    {(p as { website?: string | null }).website ? (
                      <a
                        href={((p as { website?: string | null }).website ?? "").startsWith("http") ? (p as { website?: string | null }).website! : `https://${(p as { website?: string | null }).website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] text-fg-muted hover:text-gold-300 hover:underline"
                      >
                        {((p as { website?: string | null }).website ?? "").replace(/^https?:\/\//, "")}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-xs text-fg-muted">
                    {p.notes ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <DeletePartnerBtn id={p.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
