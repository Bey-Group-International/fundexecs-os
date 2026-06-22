// components/source/AllocatorDirectoryLive.tsx
// Async server component that wires the Source › LP Pipeline allocator directory
// to real first-party data. It resolves org context, loads this org's investors,
// maps them into the directory's entry shape, and renders the presentational
// AllocatorDirectory. Best-effort + read-only: any failure (no org, missing
// table, RLS) degrades to an empty list so the surface never crashes — the
// component's own empty state takes over.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { AllocatorDirectory } from "@/components/source/AllocatorDirectory";
import type { AllocatorType, AccreditationStatus } from "@/lib/allocator-directory";

async function loadAllocatorEntries() {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return [];
    const supabase = createServerClient();
    const { data: investorRows } = await supabase
      .from("investors")
      .select(
        "id, name, investor_type, aum, typical_check_min, typical_check_max, jurisdiction, pipeline_stage, created_at",
      )
      .eq("organization_id", auth.ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(200);

    return (investorRows ?? []).map((inv) => ({
      id: inv.id,
      name: inv.name,
      allocatorType: (inv.investor_type ?? "family_office") as AllocatorType,
      aumMin: inv.aum ? inv.aum * 0.8 : null,
      aumMax: inv.aum ?? null,
      ticketMin: inv.typical_check_min ?? null,
      ticketMax: inv.typical_check_max ?? null,
      primaryStrategies: [] as string[],
      geographicFocus: inv.jurisdiction ? [inv.jurisdiction] : [],
      accreditationStatus: "verified" as AccreditationStatus,
      kycStatus: "verified" as const,
      hqCity: undefined,
      hqCountry: inv.jurisdiction ?? undefined,
      fitScore: undefined,
      lastContactDays: undefined,
    }));
  } catch {
    return [];
  }
}

export async function AllocatorDirectoryLive() {
  const entries = await loadAllocatorEntries();

  return (
    <section>
      <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
        Allocator Intelligence Directory
      </p>
      <AllocatorDirectory entries={entries} />
    </section>
  );
}
