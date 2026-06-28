// components/source/ServiceProviderDirectoryLive.tsx
// Server component — loads service_providers for the enriched directory view.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ServiceProviderDirectory } from "@/components/source/ServiceProviderDirectory";
import type { ProviderEntry } from "@/components/source/ServiceProviderDirectory";

export async function ServiceProviderDirectoryLive() {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return null;
    const supabase = createServerClient();

    const { data } = await supabase
      .from("service_providers")
      .select("id, name, provider_type, contact_name, contact_email, status, notes")
      .eq("organization_id", auth.ctx.orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(200);

    const providers: ProviderEntry[] = (data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      providerType: (r.provider_type ?? "other") as string,
      contactName: r.contact_name as string | null,
      contactEmail: r.contact_email as string | null,
      status: (r.status ?? "active") as string,
      notes: r.notes as string | null,
    }));

    return <ServiceProviderDirectory providers={providers} />;
  } catch {
    return null;
  }
}
