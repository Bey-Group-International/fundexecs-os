// Server component wrapper — fetches partner rows and passes to the client PartnersTable.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { PartnersTable } from "@/components/source/PartnersLive";

async function loadPartners() {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return [];
    const supabase = await createServerClient();
    const { data } = await supabase
      .from("partners")
      .select(
        "id, name, partner_type, contact_name, contact_email, contact_phone, role, website, url_source, provenance, status, notes",
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
  return <PartnersTable partners={partners} />;
}
