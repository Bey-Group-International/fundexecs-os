// components/source/PartnersLive.tsx
// Async server component — renders the active partner pipeline for this org.
// Best-effort: any auth/DB failure degrades to an empty state, never a crash.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

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
        "id, name, partner_type, contact_name, contact_email, status, notes",
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
        <span className="font-mono text-[11px] text-fg-muted">
          {partners.length} partner{partners.length !== 1 ? "s" : ""}
        </span>
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
                  Notes
                </th>
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
                      <span className="text-fg">
                        {p.contact_name}
                        {p.contact_email && (
                          <a
                            href={`mailto:${p.contact_email}`}
                            className="ml-2 text-xs text-accent underline-offset-2 hover:underline"
                          >
                            {p.contact_email}
                          </a>
                        )}
                      </span>
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
                  <td className="max-w-[260px] truncate px-4 py-3 text-xs text-fg-muted">
                    {p.notes ?? "—"}
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
