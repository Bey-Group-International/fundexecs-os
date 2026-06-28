// components/source/ServiceProviderDirectoryLive.tsx
// Async server component — loads service providers, enriches with Apollo where
// a name is available, and hands off to the ServiceProviderDirectory client component.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ServiceProviderDirectory } from "@/components/source/ServiceProviderDirectory";
import { VerificationPill } from "@/components/source/VerificationBadge";
import { getCached, setCached } from "@/lib/source-cache";
import { enrichOrganization } from "@/lib/integrations/providers/apollo";
import type { ProviderEntry } from "@/components/source/ServiceProviderDirectory";

interface ProviderRow {
  id: string;
  name: string;
  provider_type: string | null;
  contact_name: string | null;
  contact_email: string | null;
  status: string | null;
  notes: string | null;
  website: string | null;
}

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
    if (result.status !== "failed" && result.data) {
      await setCached(orgId, "provider", "apollo", params, result);
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
      .select("id, name, provider_type, contact_name, contact_email, status, notes, website")
      .eq("organization_id", auth.ctx.orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(200);

    const rows = (data ?? []) as unknown as ProviderRow[];

    const PROVIDER_BUDGET_MS = 22_000;
    const deadline = Date.now() + PROVIDER_BUDGET_MS;
    const enrichments: EnrichedProviderData[] = [];
    for (let i = 0; i < Math.min(rows.length, ENRICH_CAP); i += BATCH_SIZE) {
      if (Date.now() > deadline) break;
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
          {providers.length > 0 && verifiedCount > 0 && (
            <div className="flex items-center gap-2">
              <VerificationPill
                verified={true}
                confidence={verifiedCount / Math.min(providers.length, ENRICH_CAP)}
                provider="apollo"
              />
              <span className="text-xs text-fg-muted">
                {verifiedCount}/{Math.min(providers.length, ENRICH_CAP)} live
              </span>
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
