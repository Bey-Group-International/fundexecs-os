// components/source/ServiceProviderDirectoryLive.tsx
// Async server component — loads service providers, enriches with Apollo where
// a name is available, and hands off to the ServiceProviderDirectory client component.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ServiceProviderDirectory } from "@/components/source/ServiceProviderDirectory";
import { getCached, setCached } from "@/lib/source-cache";
import { enrichOrganization } from "@/lib/integrations/providers/apollo";
import type { ProviderEntry } from "@/components/source/ServiceProviderDirectory";
import { ClearProvidersBtn } from "@/components/source/SourceDeleteControls";

type ProviderRow = {
  id: string;
  name: string;
  provider_type: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  role: string | null;
  url_source: string | null;
  status: string | null;
  notes: string | null;
  website: string | null;
};

interface EnrichedProviderData {
  website?: string;
  description?: string;
  employeeRange?: string;
  confidence: number;
  verified: boolean;
  provider: string;
}

async function enrichProviderRow(
  orgId: string,
  row: ProviderRow
): Promise<EnrichedProviderData> {
  const domain = row.website
    ? row.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    : null;

  if (!domain && !row.name) {
    return { confidence: 0.3, verified: false, provider: "manual" };
  }

  const params: Record<string, unknown> = domain
    ? { domain, name: row.name }
    : { name: row.name };

  const cached = await getCached<{
    name: string;
    domain?: string;
    description?: string;
    confidence: number;
    employee_range?: string;
  } | null>(orgId, "provider", "apollo", params);

  if (cached?.data) {
    return {
      website: domain ? `https://${domain}` : cached.data.domain ? `https://${cached.data.domain}` : undefined,
      description: cached.data.description,
      employeeRange: cached.data.employee_range,
      confidence: cached.data.confidence,
      verified: cached.verified,
      provider: "apollo",
    };
  }

  try {
    let _timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      enrichOrganization({ domain: domain ?? undefined, name: row.name }).finally(() => clearTimeout(_timer)),
      new Promise<never>((_, reject) => {
        _timer = setTimeout(() => reject(new Error("timeout")), 5000);
      }),
    ]);
    if (result.status !== "failed") {
      await setCached(orgId, "provider", "apollo", params, result);
      if (!result.data) {
        return { confidence: result.confidence ?? 0.3, verified: false, provider: "manual" };
      }
      return {
        website: result.data.website,
        description: result.data.description,
        employeeRange: result.data.employee_range,
        confidence: result.data.confidence,
        verified: result.verified,
        provider: "apollo",
      };
    }
  } catch {
    // Non-fatal
  }

  return { confidence: 0.3, verified: false, provider: "manual" };
}

const ENRICH_CAP = 50;
const BATCH_SIZE = 10;

export async function ServiceProviderDirectoryLive() {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return null;
    const supabase = createServerClient();

    const { data } = await supabase
      .from("service_providers")
      .select("id, name, provider_type, contact_name, contact_email, contact_phone, role, url_source, status, notes, website")
      .eq("organization_id", auth.ctx.orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(200);

    const rows = (data ?? []) as ProviderRow[];

    const PROVIDER_BUDGET_MS = 22_000;
    const deadline = Date.now() + PROVIDER_BUDGET_MS;
    const enrichments: EnrichedProviderData[] = [];
    for (let i = 0; i < Math.min(rows.length, ENRICH_CAP); i += BATCH_SIZE) {
      if (Date.now() + 5000 > deadline) break;
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        chunk.map((r) =>
          enrichProviderRow(auth.ctx.orgId, r).catch(() => ({
            confidence: 0.3,
            verified: false,
            provider: "manual" as const,
          }))
        )
      );
      enrichments.push(...results);
    }

    const providers: ProviderEntry[] = rows.map((r, i) => {
      const enr = enrichments[i] ?? { confidence: 0.3, verified: false, provider: "manual" };
      return {
        id: r.id,
        name: r.name,
        providerType: r.provider_type ?? "other",
        contactName: r.contact_name,
        contactEmail: r.contact_email,
        contactPhone: r.contact_phone,
        role: r.role,
        urlSource: r.url_source,
        status: r.status ?? "active",
        notes: r.notes,
        website: enr.website ?? (r.website ?? undefined),
        description: enr.description,
        employeeRange: enr.employeeRange,
        verified: enr.verified,
        confidence: enr.confidence,
        provider: enr.provider,
      };
    });

    const verifiedCount = providers.filter((p) => p.verified).length;

    return (
      <section>
        <div className="mb-4 flex items-center justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
            Service Provider Directory
          </p>
          {providers.length > 0 && (
            <div className="flex items-center gap-2">
              {verifiedCount > 0 && (
                <span className="text-xs text-fg-muted">
                  {verifiedCount}/{Math.min(providers.length, ENRICH_CAP)} enriched via Apollo
                </span>
              )}
              <ClearProvidersBtn />
            </div>
          )}
        </div>
        <ServiceProviderDirectory providers={providers} />
      </section>
    );
  } catch {
    return null;
  }
}
